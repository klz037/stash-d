import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CreateFriendNoteRequest, FriendNoteDto } from '@stashd/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserDocument } from '../users/schemas/user.schema';
import { NotesService } from './notes.service';

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  list(@CurrentUser() user: UserDocument): Promise<FriendNoteDto[]> {
    return this.notesService.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: UserDocument,
    @Body() body: CreateFriendNoteRequest,
  ): Promise<FriendNoteDto> {
    return this.notesService.create(user, body);
  }
}
