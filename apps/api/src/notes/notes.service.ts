import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CreateFriendNoteRequest, FriendNoteDto } from '@stashd/shared';
import { Model } from 'mongoose';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { Note, NoteDocument } from './schemas/note.schema';

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly usersService: UsersService,
  ) {}

  async list(owner: UserDocument): Promise<FriendNoteDto[]> {
    const notes = await this.noteModel.find({ ownerId: owner._id }).sort({ createdAt: -1 }).exec();
    return Promise.all(notes.map((note) => this.toDto(note)));
  }

  async create(owner: UserDocument, body: CreateFriendNoteRequest): Promise<FriendNoteDto> {
    const friend = await this.usersService.findById(body.friendId);
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }
    const note = await this.noteModel.create({
      ownerId: owner._id,
      friendId: body.friendId,
      text: body.text.trim(),
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    });
    return this.toDto(note, friend.displayName);
  }

  private async toDto(note: NoteDocument, friendName?: string): Promise<FriendNoteDto> {
    const name =
      friendName ??
      (await this.usersService.findById(note.friendId))?.displayName ??
      'Friend';
    return {
      id: String(note._id),
      ownerId: note.ownerId,
      friendId: note.friendId,
      friendName: name,
      text: note.text,
      dueAt: note.dueAt ? note.dueAt.toISOString() : undefined,
      createdAt: (note.createdAt ?? new Date()).toISOString(),
    };
  }
}
