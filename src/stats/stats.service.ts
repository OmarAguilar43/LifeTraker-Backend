import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { GoalRangeDto } from './dto/goal-range.dto';
import { ActivityMetricsDto } from './dto/activity-metrics.dto';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeDay(iso: string) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new BadRequestException('date inválida');
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private resolveRange(q: GoalRangeDto | ActivityMetricsDto) {
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setUTCDate(now.getUTCDate() - 30);

    const from = q.from ? this.normalizeDay(q.from) : this.normalizeDay(defaultFrom.toISOString());
    const to = q.to ? this.normalizeDay(q.to) : this.normalizeDay(now.toISOString());
    if (from > to) throw new ForbiddenException('from debe ser <= to');
    return { from, to };
  }

  private async getOwnedGoal(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal no encontrada');
    if (goal.userId !== userId) throw new ForbiddenException();
    return goal;
  }

  private async assertStreakMember(userId: string, streakId: string) {
    const member = await this.prisma.streakMember.findUnique({
      where: { streakId_userId: { streakId, userId } },
    });
    if (!member) throw new ForbiddenException('No eres miembro de esta racha');
    return member;
  }

  async goalProgress(userId: string, goalId: string, q: GoalRangeDto) {
  const goal = await this.getOwnedGoal(userId, goalId);
  const { from, to } = this.resolveRange(q);

  const checkins = await this.prisma.goalCheckin.findMany({
    where: {
      goalId,
      userId,
      date: { gte: from, lte: to },
    },
  });

  const total = checkins.length;

  const doneCheckins = checkins.filter(
    (c) => c.done || (c.value ?? 0) > 0,
  );

  const doneCount = doneCheckins.length;
  const valueSum = checkins.reduce((acc, c) => acc + (c.value ?? 0), 0);


  const doneDays = new Set(
    doneCheckins.map((c) =>
      this.normalizeDay(c.date.toISOString()).toISOString(),
    ),
  ).size;

  const target = goal.targetValue ?? null;

  let completion: number | null = null;

 
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  if (goal.targetType === 'DAILY') {
    

    // fecha de inicio normalizada
    const goalStart = this.normalizeDay(goal.startDate.toISOString());

    
    const rawEnd = goal.endDate ?? to;
    const goalEnd = this.normalizeDay(rawEnd.toISOString());

    if (goalEnd >= goalStart) {
      const diffMs = goalEnd.getTime() - goalStart.getTime();
      const totalDays = Math.floor(diffMs / MS_PER_DAY) + 1; // inclusivo

      if (totalDays > 0) {
        const clampedDone = Math.min(doneDays, totalDays);
        completion = clampedDone / totalDays; 
      }
    } else {
      
      completion = null;
    }
  } else if (target && target > 0) {
    
    completion = Math.min(1, valueSum / target);
  } else {
   
    completion = null;
  }

  return {
    goalId,
    targetType: goal.targetType,
    targetValue: target,
    from,
    to,
    totalCheckins: total,
    doneCount,
    valueSum,
    completion,
  };
}


  


  async goalHeatmap(userId: string, goalId: string, q: GoalRangeDto) {
    await this.getOwnedGoal(userId, goalId);
    const { from, to } = this.resolveRange(q);

    const rows = await this.prisma.goalCheckin.groupBy({
      by: ['date'],
      where: {
        goalId,
        userId,
        date: { gte: from, lte: to },
      },
      _count: { _all: true },
    });

    return rows
      .map((r) => ({
        date: this.normalizeDay(r.date.toISOString()).toISOString(),
        count: r._count._all,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async streakHeatmap(userId: string, streakId: string, q: GoalRangeDto) {
    await this.assertStreakMember(userId, streakId);
    const { from, to } = this.resolveRange(q);

    const rows = await this.prisma.streakCheckin.groupBy({
      by: ['date'],
      where: {
        streakId,
        userId,
        date: { gte: from, lte: to },
        done: true,
      },
      _count: { _all: true },
    });

    return rows
      .map((r) => ({
        date: this.normalizeDay(r.date.toISOString()).toISOString(),
        count: r._count._all,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private bucketKey(d: Date, period: 'day' | 'week' | 'month') {
    if (period === 'day') {
      return d.toISOString().slice(0, 10);
    }

    if (period === 'month') {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // ISO week number
    const dayNum = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayNum));
    const firstThursday = new Date(Date.UTC(weekStart.getUTCFullYear(), 0, 4));
    const weekNumber = Math.floor((+weekStart - +firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;

    return `${weekStart.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
  }

  async activityMetrics(userId: string, q: ActivityMetricsDto) {
    const { from, to } = this.resolveRange(q);
    const period = q.period ?? 'day';

    const goalCheckins = await this.prisma.goalCheckin.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, done: true, value: true },
    });

    const streakCheckins = await this.prisma.streakCheckin.findMany({
      where: { userId, date: { gte: from, lte: to }, done: true },
      select: { date: true },
    });

    const buckets = new Map<
      string,
      { goalCheckins: number; streakCheckins: number; total: number; key: string }
    >();

    const upsertBucket = (key: string) => {
      if (!buckets.has(key)) {
        buckets.set(key, { key, goalCheckins: 0, streakCheckins: 0, total: 0 });
      }
      return buckets.get(key)!;
    };

    for (const c of goalCheckins) {
      const day = this.normalizeDay(c.date.toISOString());
      const key = this.bucketKey(day, period);
      const bucket = upsertBucket(key);
      bucket.goalCheckins += c.done || (c.value ?? 0) > 0 ? 1 : 0;
      bucket.total = bucket.goalCheckins + bucket.streakCheckins;
    }

    for (const c of streakCheckins) {
      const day = this.normalizeDay(c.date.toISOString());
      const key = this.bucketKey(day, period);
      const bucket = upsertBucket(key);
      bucket.streakCheckins += 1;
      bucket.total = bucket.goalCheckins + bucket.streakCheckins;
    }

    const items = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));

    return {
      period,
      from,
      to,
      buckets: items,
    };
  }


  

  
}
