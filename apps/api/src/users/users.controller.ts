import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
    @Body() body: UpdateProfileDto,
  ): Promise<UserDto> {
    const updated = await this.usersService.updateProfile(user, body);
    return this.usersService.toDto(updated);
  }
}
