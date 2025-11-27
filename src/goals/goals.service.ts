import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalTargetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, createGoalDto: CreateGoalDto) {
    // Validaciones de negocio
    this.validateDates(createGoalDto.startDate, createGoalDto.endDate ?? undefined);
    this.validateTarget(createGoalDto.targetType, createGoalDto.targetValue ?? undefined);

    if (createGoalDto.categoryId) {
      const category = await this.prisma.activityCategory.findUnique({ where: { id: createGoalDto.categoryId } });
      if (!category) throw new BadRequestException('categoryId inválido');
    }

    return this.prisma.goal.create({
      data: {
        userId,
        title: createGoalDto.title,
        description: createGoalDto.description ?? null,
        categoryId: createGoalDto.categoryId ?? null,
        targetType: createGoalDto.targetType,
        targetValue: createGoalDto.targetValue ?? null,
        startDate: new Date(createGoalDto.startDate),
        endDate: createGoalDto.endDate ? new Date(createGoalDto.endDate) : null,
        isArchived: createGoalDto.isArchived ?? false,
      },
    });
  }

  async findByUser(userId: string, params?: { archived?: boolean; param?: string }) {
    
    const where: Prisma.GoalWhereInput = {
      userId,
      ...(params?.archived !== undefined ? { isArchived: params.archived } : {}),
      ...(params?.param ? { title: { contains: params.param, mode: 'insensitive' } } : {}),
    };

    return this.prisma.goal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { category: true },
    });
  }

  async findOne(userId: string, id: string) {
    const goal = await this.prisma.goal.findUnique({
      where: { id },
      include: { category: true, checkins: true },
    });
    if (!goal) throw new NotFoundException('Goal no encontrada');
    if (goal.userId !== userId) throw new ForbiddenException();
    return goal;
  }

  async update(userId: string, id: string, updateGoalDto: UpdateGoalDto) {

    const currenGoal = await this.prisma.goal.findUnique({ where: { id } });

    if (!currenGoal) throw new NotFoundException('Goal no encontrada');
    if (currenGoal.userId !== userId) throw new ForbiddenException();

    // Validar cambios
    const startIso = updateGoalDto.startDate ?? currenGoal.startDate.toISOString();
    const endIso = (updateGoalDto.endDate ?? currenGoal.endDate?.toISOString()) ?? undefined;
    this.validateDates(startIso, endIso);

    const type = updateGoalDto.targetType ?? currenGoal.targetType;
    const val = updateGoalDto.targetValue ?? currenGoal.targetValue ?? undefined;
    this.validateTarget(type, val);

    if (updateGoalDto.categoryId) {
      const category = await this.prisma.activityCategory.findUnique({ where: { id: updateGoalDto.categoryId } });
      if (!category) throw new BadRequestException('categoryId inválido');
    }

    return this.prisma.goal.update({
      where: { id },
      data: {
        title: updateGoalDto.title ?? undefined,
        description: updateGoalDto.description ?? undefined,
        categoryId: updateGoalDto.categoryId === null ? null : updateGoalDto.categoryId ?? undefined,
        targetType: updateGoalDto.targetType ?? undefined,
        targetValue: updateGoalDto.targetValue === null ? null : updateGoalDto.targetValue ?? undefined,
        startDate: updateGoalDto.startDate ? new Date(updateGoalDto.startDate) : undefined,
        endDate: updateGoalDto.endDate === null ? null : updateGoalDto.endDate ? new Date(updateGoalDto.endDate) : undefined,
        isArchived: updateGoalDto.isArchived ?? undefined,
      },
      include: { category: true },
    });
  }

  // archivar
  async remove(userId: string, id: string) {
    const current = await this.prisma.goal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Goal no encontrada');
    if (current.userId !== userId) throw new ForbiddenException();

    return this.prisma.goal.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  private validateDates(startdate: string, enddate?: string) {
    const start = new Date(startdate);
    if (isNaN(start.getTime())) throw new BadRequestException('startDate inválida');
    if (enddate) {
      const end = new Date(enddate);
      if (isNaN(end.getTime())) throw new BadRequestException('endDate inválida');
      if (end < start) throw new BadRequestException('endDate debe ser >= startDate');
    }
  }

  private validateTarget(type: GoalTargetType, val?: number) {
    const needs = type === 'COUNT' || type === 'WEEKLY';
    if (needs && (!val || val < 1)) throw new BadRequestException('targetValue requerido y >= 1 para COUNT/WEEKLY');
  }
}
