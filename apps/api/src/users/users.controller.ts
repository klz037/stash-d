import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  UpdateLocationRequest,
  UpdateProfileRequest,
  UserDto,
} from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from './schemas/user.schema';
import { UsersService } from './users.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: UserDocument): UserDto {
    return this.usersService.toDto(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: UserDocument,
    @Body() body: UpdateProfileRequest,
  ): Promise<UserDto> {
    const updated = await this.usersService.updateProfile(user, body);
    return this.usersService.toDto(updated);
  }

  @Post('me/location')
  async updateLocation(
    @CurrentUser() user: UserDocument,
    @Body() body: UpdateLocationRequest,
  ): Promise<UserDto> {
    const updated = await this.usersService.updateLocation(user, body);
    return this.usersService.toDto(updated);
  }
}
