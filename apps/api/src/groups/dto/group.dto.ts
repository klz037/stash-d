import { MAX_GROUP_MEMBERS } from '@stashd/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GROUP_MEMBERS)
  @IsString({ each: true })
  memberIds?: string[];
}

export class JoinGroupDto {
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;
}
