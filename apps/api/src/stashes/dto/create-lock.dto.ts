import { ConditionType, LockContext, MAX_MOMENT_LENGTH, MAX_RECIPIENTS } from '@stashd/shared';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLockDto {
  /** 'me' is accepted as an alias for the caller's own id. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  recipientIds!: string[];

  @IsString()
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  imageUrl?: string;

  @IsIn(['MANUAL', 'TOGETHER', 'RECIPIENT_SET'])
  conditionType!: ConditionType;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  conditionLabel?: string;

  /** A moment in the sender's words. Normalized server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_MOMENT_LENGTH)
  context?: LockContext | null;

  @IsOptional()
  @IsBoolean()
  requiresMfa?: boolean;

  /** Answering a TOGETHER lock. The server forces the type and the recipient. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  replyToId?: string;

  /**
   * A Spotify track id / URI / link. The server re-resolves it against Spotify
   * and stores canonical metadata, so a caller cannot plant an arbitrary image
   * URL in someone else's Stash.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  songTrackId?: string;
}
