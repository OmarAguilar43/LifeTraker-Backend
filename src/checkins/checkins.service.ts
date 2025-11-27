import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCheckinDto } from './dto/create-checkin.dto';
import { UpdateCheckinDto } from './dto/update-checkin.dto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { GoalTargetType, Prisma } from '@prisma/client';
import { ListCheckinsDto } from './dto/list-checkins.dto';

@Injectable()
export class CheckinsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeDate(dateIso: string): Date {
    const day = new Date(dateIso);
    if (isNaN(day.getTime())) throw new BadRequestException('date inválida');
    // Normalizar a 00:00:00.000 UTC
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  }

  private validateAccordingToGoal(type: GoalTargetType, targetValue: number | null, dto: { value?: number; done?: boolean }) {
    const needsValue = type === 'COUNT' || type === 'WEEKLY';
    if (needsValue) {
      if (dto.value === undefined || dto.value === null) throw new BadRequestException('value requerido para metas COUNT/WEEKLY');
      if (dto.value < 1) throw new BadRequestException('value debe ser >= 1');
    } else {
      if (dto.value !== undefined) throw new BadRequestException('value no aplica para metas DAILY/BOOLEAN');
    }
  }

  async create(userId: string, dto: CreateCheckinDto) {
    const goal = await this.prisma.goal.findUnique({ where: { id: dto.goalId } });
    if (!goal) throw new NotFoundException('Goal no encontrada');
    if (goal.userId !== userId) throw new ForbiddenException();

    const date = this.normalizeDate(dto.date);
    if (date < this.normalizeDate(goal.startDate.toISOString())) throw new BadRequestException('date antes de startDate');
    if (goal.endDate && date > this.normalizeDate(goal.endDate.toISOString())) throw new BadRequestException('date después de endDate');

    this.validateAccordingToGoal(goal.targetType, goal.targetValue, dto);

    const computedDone = (() => {
      if (goal.targetType === 'COUNT' || goal.targetType === 'WEEKLY') {
        if (goal.targetValue && dto.value !== undefined) return dto.value >= goal.targetValue;
        return dto.done ?? false;
      }
      // DAILY/BOOLEAN
      return dto.done ?? true;
    })();

    try {
      
      return await this.prisma.goalCheckin.create({
        data: {
          goalId: dto.goalId,
          userId,
          date,
          value: dto.value ?? null,
          done: computedDone,
        },
        
      });
      
    } 
    
    catch (error) {
      if (error?.code === 'P2002') throw new BadRequestException('Ya existe un checkin para ese día');
      throw error;
    }
  }

  async findAll(userId: string, q: ListCheckinsDto) {
    const goal = await this.prisma.goal.findUnique({ where: { id: q.goalId } });
    if (!goal) throw new NotFoundException('Goal no encontrada');
    if (goal.userId !== userId) throw new ForbiddenException();

    const where: Prisma.GoalCheckinWhereInput = {
      goalId: q.goalId,
      ...(q.from || q.to
        ? {
            date: {
              gte: q.from ? this.normalizeDate(q.from) : undefined,
              lte: q.to ? this.normalizeDate(q.to) : undefined,
            },
          }
        : {}),
    };
    return this.prisma.goalCheckin.findMany({ where, orderBy: { date: 'asc' } });
  }

  async findOne(userId: string, id: string) {
    const checkin = await this.prisma.goalCheckin.findUnique({ where: { id } });
    if (!checkin) throw new NotFoundException('Checkin no encontrado');
    if (checkin.userId !== userId) throw new ForbiddenException();
    return checkin;
  }

  async update(userId: string, id: string, dto: UpdateCheckinDto) {
    const current = await this.prisma.goalCheckin.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Checkin no encontrado');
    if (current.userId !== userId) throw new ForbiddenException();

    const goal = await this.prisma.goal.findUnique({ where: { id: current.goalId } });
    if (!goal) throw new NotFoundException('Goal no encontrada');

    this.validateAccordingToGoal(goal.targetType, goal.targetValue, dto);

    const nextDate = dto.date ? this.normalizeDate(dto.date) : undefined;
    if (nextDate) {
      if (nextDate < this.normalizeDate(goal.startDate.toISOString())) throw new BadRequestException('date antes de startDate');
      if (goal.endDate && nextDate > this.normalizeDate(goal.endDate.toISOString())) throw new BadRequestException('date después de endDate');
    }

    const computedDone = (() => {
      if (dto.done !== undefined) return dto.done;
      if (goal.targetType === 'COUNT' || goal.targetType === 'WEEKLY') {
        const value = dto.value ?? current.value ?? undefined;
        if (value !== undefined && goal.targetValue) return value >= goal.targetValue;
        return current.done;
      }
      return current.done;
    })();

    try {
      return await this.prisma.goalCheckin.update({
        where: { id },
        data: {
          date: nextDate ?? undefined,
          value: dto.value === undefined ? undefined : dto.value,
          done: computedDone,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') throw new BadRequestException('Ya existe un checkin para ese día');
      throw error
    }
  }

  async remove(userId: string, id: string) {
    const current = await this.prisma.goalCheckin.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Checkin no encontrado');
    if (current.userId !== userId) throw new ForbiddenException();
    return this.prisma.goalCheckin.delete({ where: { id } });
  }

    async findToday(userId: string, dateStr?: string) {
    const base = dateStr ? new Date(dateStr) : new Date();

    const start = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      0, 0, 0, 0,
    );

    const end = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + 1,
      0, 0, 0, 0,
    );

    return this.prisma.goalCheckin.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lt: end,
        },
      },
      orderBy: { date: 'asc' },
      include: {
        goal: true, 
      },
    });
  }
}
