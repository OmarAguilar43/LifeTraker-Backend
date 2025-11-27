import { Module } from '@nestjs/common';
import { UsersService } from './users.controller';
import { UsersController } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
