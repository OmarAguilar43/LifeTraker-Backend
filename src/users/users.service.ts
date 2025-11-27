import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.controller';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';


@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 🔹 Obtener mi propio perfil
  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.usersService.findById(userId);
  }

  // Obtener únicamente el perfil del usuario
  @Get('me/profile')
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.getProfile(userId);
  }


  // 🔹 Actualizar mi perfil
  @Patch('me')
  updateMe(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(userId, dto);
  }


  // 🔹 Eliminar mi cuenta
  @Delete('me')
  removeMe(@CurrentUser('sub') userId: string) {
    return this.usersService.remove(userId);
  }

  // 🔹 ADMIN endpoints (opcional)
  // Si no tienes roles, puedes protegerlos así:
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}