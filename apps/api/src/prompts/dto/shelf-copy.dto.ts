import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { PromptDto } from '@stashd/shared';

const KINDS: PromptDto['kind'][] = ['tier0', 'tier05', 'tier1'];
const EMOTIONS: NonNullable<PromptDto['emotion']>[] = [
  'stress',
  'lull',
  'milestone',
  'weather',
  'reciprocity',
  'waiting',
  'memory',
];

export class ShelfCopyItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(400)
  body!: string;

  @IsIn(KINDS)
  kind!: PromptDto['kind'];

  @IsOptional()
  @IsIn(EMOTIONS)
  emotion?: PromptDto['emotion'];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  friendName?: string;
}

export class ShelfCopyDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ShelfCopyItemDto)
  items!: ShelfCopyItemDto[];
}
