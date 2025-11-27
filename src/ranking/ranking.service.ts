import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { ComputeRankingDto } from './dto/compute-ranking.dto';
import { ListRankingsDto } from './dto/list-rankings.dto';
import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class RankingsService {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService

  ) {}

  
 async compute(dto: ComputeRankingDto) {
  const from = new Date(dto.from);
  const to = new Date(dto.to);

  const toInclusive = new Date(to);
  toInclusive.setHours(23, 59, 59, 999);

  
  const goalAgg = await this.prisma.goalCheckin.groupBy({
    by: ['userId'],
    where: {
      date: {
        gte: from,
        lte: toInclusive,
      },
      OR: [{ done: true }, { value: { gt: 0 } }],
    },
    _count: { _all: true },
  });

 
  const streakAgg = await this.prisma.streakCheckin.groupBy({
    by: ['userId'],
    where: {
      date: {
        gte: from,
        lte: toInclusive,
      },
      done: true,
    },
    _count: { _all: true },
  });

 
  const scoresMap = new Map<string, number>();

  for (const row of goalAgg) {
    const prev = scoresMap.get(row.userId) ?? 0;
    scoresMap.set(row.userId, prev + row._count._all);
  }

  for (const row of streakAgg) {
    const prev = scoresMap.get(row.userId) ?? 0;
    scoresMap.set(row.userId, prev + row._count._all);
  }

  //  Limpiar ranking viejo y guardar nuevo
  await this.prisma.rankingEntry.deleteMany({
    where: { period: dto.period },
  });

  const entriesData = Array.from(scoresMap.entries())
    .filter(([, score]) => score > 0)
    .map(([userId, score]) => ({
      period: dto.period,
      userId,
      score,
      extra: dto.metadata ?? null,
    }));

  if (entriesData.length === 0) {
    return { period: dto.period, entries: [] };
  }

  await this.prisma.rankingEntry.createMany({
    data: entriesData,
  });

  // Recuperar ranking ordenado
  const rankings = await this.prisma.rankingEntry.findMany({
    where: { period: dto.period },
    orderBy: { score: 'desc' },
    include: {
      user: {
        select: { id: true, username: true, email: true },
      },
    },
  });

  const totalUsers = rankings.length;

  // Crear notificaciones para cada usuario
  //    
  await Promise.all(
    rankings.map((entry, index) => {
      const rank = index + 1; // 1-based
      const isTop3 = rank <= 3;

      return this.notifications.createForUser(entry.userId, {
        type: isTop3 ? 'RANKING_TOP3' : 'RANKING_RESULT',
        payload: {
          period: dto.period,
          rank,
          score: entry.score,
          totalUsers,
          // lo que quieras extra:
          label: dto.metadata?.label ?? null,
        },
      });
    }),
  );

  return {
    period: dto.period,
    from,
    to: toInclusive,
    totalUsers,
    rankings,
  };
}


  async list(q: ListRankingsDto) {
    const rankings = await this.prisma.rankingEntry.findMany({
      where: { period: q.period },
      orderBy: { score: 'desc' },
      take: q.limit ?? undefined,
      include: {
        user: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    return {
      period: q.period,
      totalUsers: rankings.length,
      rankings,
    };
  }
}
