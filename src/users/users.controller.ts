import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const publicUserSelect={
  id:true,
  email:true,
  username:true,
  createdAt:true,
  updatedAt:true
}satisfies Prisma.UserSelect

@Injectable()
export class UsersService {

constructor(private readonly prisma:PrismaService){
    
  }

  async create(data: Prisma.UserCreateInput) {

    const hashedPassword = await bcrypt.hash(data.passwordHash,10)

    try {
      
      const user = await this.prisma.user.create({
        data:{
          ...data,
          passwordHash:hashedPassword
        },select:publicUserSelect
      })

      return user

    } catch (error:unknown) {
      return error
    }
  }

  findAll() {
    return this.prisma.user.findMany({
      select:publicUserSelect
    })
  }

  async findById(id: string) {
      
      const user =await this.prisma.user.findUnique({
        where:{id},
        select:publicUserSelect
      })

      if(!user)throw new NotFoundException(`Usuario con el id ${id} no encontrado`)

      return user
    }

     async getProfile(userId: string) {
    return this.prisma.profile.findUnique({
      where: { userId },
    });
  }


  async update(userId: string, updateUserDto: UpdateUserDto) {

    return await this.prisma.profile.upsert({
      where:{userId},
      update:{
        fullName: updateUserDto.fullName,
        avatarUrl: updateUserDto.avatarUrl,
        bio: updateUserDto.bio,
      },
      create:{
         userId:userId,
        fullName: updateUserDto.fullName,
        avatarUrl: updateUserDto.avatarUrl,
        bio: updateUserDto.bio,
      }
  })
  
  }

  async remove(id: string) {
    await this.findById(id); 
    return this.prisma.user.delete({
      where: { id },
      select: publicUserSelect,
    });
  }}