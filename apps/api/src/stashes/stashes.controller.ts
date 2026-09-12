import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LockDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateLockDto } from './dto/create-lock.dto';
import { SetConditionDto } from './dto/set-condition.dto';
import { StashesService } from './stashes.service';

@Controller('locks')
@UseGuards(JwtAuthGuard)
export class StashesController {
  constructor(
    private readonly stashesService: StashesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  async inbox(@CurrentUser() user: UserDocument): Promise<LockDto[]> {
    const locks = await this.stashesService.listInbox(user);
    return Promise.all(locks.map((lock) => this.stashesService.toDto(lock, user._id)));
  }

  @Get('sent')
  async sent(@CurrentUser() user: UserDocument): Promise<LockDto[]> {
    const locks = await this.stashesService.listSent(user);
    return Promise.all(locks.map((lock) => this.stashesService.toDto(lock, user._id)));
  }

  @Post()
  async create(
    @CurrentUser() user: UserDocument,
    @Body() body: CreateLockDto,
  ): Promise<LockDto[]> {
    const locks = await this.stashesService.create(user, body);
    const result: LockDto[] = [];
    for (const lock of locks) {
      const dto = await this.stashesService.toDto(lock, user._id);
      const recipientView = await this.stashesService.toDto(lock, lock.recipientId);
      this.realtime.notifyLockCreated(lock.senderId, lock.recipientId, recipientView);
      result.push(dto);
    }
    return result;
  }

  @Post(':id/confirm')
  async confirm(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<LockDto> {
    const lock = await this.stashesService.confirm(user, id);
    const forSender = await this.stashesService.toDto(lock, lock.senderId);
    const forRecipient = await this.stashesService.toDto(lock, lock.recipientId);
    this.realtime.notifyLockChange(lock, forSender, forRecipient);
    return user._id === lock.senderId ? forSender : forRecipient;
  }

  @Post(':id/condition')
  async condition(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() body: SetConditionDto,
  ): Promise<LockDto> {
    const lock = await this.stashesService.setCondition(
      user,
      id,
      body.conditionLabel,
    );
    const dto = await this.stashesService.toDto(lock, user._id);
    this.realtime.notifyLockUpdated(lock.senderId, lock.recipientId, dto);
    return dto;
  }
}
