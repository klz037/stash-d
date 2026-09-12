import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HereResponse, LockDto } from '@stashd/shared';
import { AuthClaims } from '../auth/auth.types';
import { CurrentClaims, CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateLockDto } from './dto/create-lock.dto';
import { HereDto } from './dto/here.dto';
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
  ): Promise<LockDto> {
    const lock = await this.stashesService.create(user, body);
    const views = await this.stashesService.toDtoForEveryone(lock);
    this.realtime.notifyLockCreated(lock, views);
    return views.get(user._id)!;
  }

  @Post(':id/confirm')
  async confirm(
    @CurrentUser() user: UserDocument,
    @CurrentClaims() claims: AuthClaims,
    @Param('id') id: string,
  ): Promise<LockDto> {
    const lock = await this.stashesService.confirm(user, id, claims);
    const views = await this.stashesService.toDtoForEveryone(lock);
    this.realtime.notifyLockChange(lock, views);
    return views.get(user._id)!;
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
    const views = await this.stashesService.toDtoForEveryone(lock);
    this.realtime.notifyLockUpdated(lock, views);
    return views.get(user._id)!;
  }

  /**
   * "I'm here." Every sealed lock addressed to the caller with a matching
   * context gets stamped, and everyone on those locks is told over the socket.
   */
  @Post('here')
  async here(
    @CurrentUser() user: UserDocument,
    @Body() body: HereDto,
  ): Promise<HereResponse> {
    const locks = await this.stashesService.markHere(user, body.context);
    const matched: LockDto[] = [];
    for (const lock of locks) {
      const views = await this.stashesService.toDtoForEveryone(lock);
      this.realtime.notifyLockUpdated(lock, views);
      matched.push(views.get(user._id)!);
    }
    return { context: body.context, matched };
  }
}
