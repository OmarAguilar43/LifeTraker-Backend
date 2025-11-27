// src/streaks/streaks.service.ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateStreakDto } from './dto/create-streak.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { ListStreakCheckinsDto } from './dto/list-streak-checkins.dto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { RecordStreakCheckinDto } from './dto/record-streak-checkin.dto';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class StreaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications:NotificationsService

  ) {}

  
  private normalizeDay(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new BadRequestException('date inválida');
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private assertOwner(userId: string, streak: { createdById: string }) {
    if (streak.createdById !== userId) throw new ForbiddenException('Solo el creador puede realizar esta acción');
  }

  async create(userId: string, dto: CreateStreakDto) {
    const start = this.normalizeDay(dto.startDate);
    const end = dto.endDate ? this.normalizeDay(dto.endDate) : undefined;
    if (end && end < start) throw new BadRequestException('endDate debe ser >= startDate');

    // Crea streak y te agrega como OWNER
    const streak = await this.prisma.streak.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        startDate: start,
        endDate: end ?? null,
        ruleJson: {},
        createdById: userId,
        members: {
          create: [{ userId, role: 'OWNER' }],
        },
      },
      include: { members: true },
    });
    return streak;
  }

  async listMine(userId: string) {
    return this.prisma.streak.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        members: { select: { id: true, userId: true, role: true, joinedAt: true } },
      },
    });
  }

  async addMember(userId: string, streakId: string, dto: AddMemberDto) {
    const streak = await this.prisma.streak.findUnique({ where: { id: streakId } });
    if (!streak) throw new NotFoundException('Streak no encontrada');
    this.assertOwner(userId, streak);

    // Evitar duplicados
    const exists = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId: dto.userId } },
    });
    if (exists) throw new BadRequestException('El usuario ya es miembro');

    return this.prisma.streakMember.create({
      data: { streakId, userId: dto.userId, role: 'MEMBER' },
    });
  }

  async removeMember(userId: string, streakId: string, memberUserId: string) {
    const streak = await this.prisma.streak.findUnique({ where: { id: streakId } });
    if (!streak) throw new NotFoundException('Streak no encontrada');
    this.assertOwner(userId, streak);

    const member = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId: memberUserId } },
    });
    if (!member) throw new NotFoundException('Miembro no encontrado');

    return this.prisma.streakMember.delete({ where: { id: member.id } });
  }

  // Check-in de racha (por miembro/día) — idempotente
  async recordCheckin(userId: string, streakId: string, dto: RecordStreakCheckinDto) {
    const streak = await this.prisma.streak.findUnique({ where: { id: streakId } });
    if (!streak) throw new NotFoundException('Streak no encontrada');

    // Debes ser miembro 
    const member = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId } },
    });
    if (!member) throw new ForbiddenException('No eres miembro de esta racha');

    const day = this.normalizeDay(dto.date);
    const start = this.normalizeDay(streak.startDate.toISOString());
    const end = streak.endDate ? this.normalizeDay(streak.endDate.toISOString()) : undefined;
    if (day < start) throw new BadRequestException('date antes de startDate');
    if (end && day > end) throw new BadRequestException('date después de endDate');

    // upsert usando clave compuesta (streakId, userId, date)
   return this.prisma.streakCheckin.upsert({
  where: {
    unique_streak_user_day: { 
      streakId,
      userId,
      date: day,
    },
  },
  update: {
    done: dto.done ?? true,
    metadata: dto.metadata ?? undefined,
  },
  create: {
    streakId,
    userId,
    date: day,
    done: dto.done ?? true,
    metadata: dto.metadata ?? {},
  },
});

  }

  async listCheckins(userId: string, streakId: string, q: ListStreakCheckinsDto) {
    // Debe ser miembro para ver checkins
    const member = await this.prisma.streakMember.findUnique({ where: { streakId_userId: { streakId, userId } } });
    if (!member) throw new ForbiddenException();

    const where: Prisma.StreakCheckinWhereInput = {
      streakId,
      ...(q.memberId ? { userId: q.memberId } : {}),
      ...(q.from || q.to
        ? {
            date: {
              gte: q.from ? this.normalizeDay(q.from) : undefined,
              lte: q.to ? this.normalizeDay(q.to) : undefined,
            },
          }
        : {}),
    };
    return this.prisma.streakCheckin.findMany({
      where,
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    });
  }

  // Estadísticas de racha para un miembro
  async statsForMember(userId: string, streakId: string, memberUserId?: string) {
    // Validar pertenencia
    const member = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId } },
    });
    if (!member) throw new ForbiddenException();

    const targetUser = memberUserId ?? userId;

    const rows = await this.prisma.streakCheckin.findMany({
      where: { streakId, userId: targetUser, done: true },
      orderBy: { date: 'asc' },
      select: { date: true },
    });

   
    let longest = 0;
    let current = 0;
    let prev: Date | null = null;

    for (const r of rows) {
      const d = this.normalizeDay(r.date.toISOString());
      if (!prev) {
        current = 1;
      } else {
        const diff = (d.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        current = diff === 1 ? current + 1 : 1;
      }
      longest = Math.max(longest, current);
      prev = d;
    }

    return { userId: targetUser, current, longest, totalDone: rows.length };
  }

  async inviteUserToStreak(streakId: string, ownerId: string, targetUserId: string) {
    const streak = await this.prisma.streak.findUnique({
      where: { id: streakId },
      include: { members: { select: { userId: true } } },
    });
    if (!streak) throw new NotFoundException('Streak no encontrada');
    this.assertOwner(ownerId, streak);

    const alreadyMember = streak.members.some((m) => m.userId === targetUserId);
    if (alreadyMember) {
      throw new BadRequestException('El usuario ya es miembro de la racha');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) throw new NotFoundException('Usuario no encontrado');

    await this.notifications.createForUser(targetUserId, {
      type: 'STREAK_INVITE',
      payload: {
        streakId: streak.id,
        title: streak.title,
        invitedById: ownerId,
      },
    });

    return { success: true };
  }

  async acceptInvite(userId: string, streakId: string) {
    const streak = await this.prisma.streak.findUnique({
      where: { id: streakId },
      include: { members: { select: { userId: true } } },
    });
    if (!streak) throw new NotFoundException('Streak no encontrada');

    const alreadyMember = streak.members.some((m) => m.userId === userId);
    if (alreadyMember) return { success: true };

    if (streak.endDate && this.normalizeDay(streak.endDate.toISOString()) < this.normalizeDay(new Date().toISOString())) {
      throw new BadRequestException('La racha ya terminó');
    }

    await this.prisma.streakMember.create({
      data: { streakId, userId, role: 'MEMBER' },
    });

    // Agrega al chat de la racha si existe
    const chat = await this.prisma.chatRoom.findFirst({ where: { streakId } });
    if (chat) {
      await this.prisma.chatMember.create({
        data: { roomId: chat.id, userId },
      }).catch(() => undefined);
    }

    return { success: true };
  }

  async rejectInvite(userId: string, streakId: string) {
    // Al no persistir invitaciones, solo devolvemos éxito si no es miembro
    const member = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId } },
    });
    if (member) throw new BadRequestException('Ya eres miembro de esta racha');
    return { success: true };
  }

}
