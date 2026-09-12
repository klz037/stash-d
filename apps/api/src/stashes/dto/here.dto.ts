import { MAX_MOMENT_LENGTH } from '@stashd/shared';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class HereDto {
  /** A moment in the recipient's words. Matched against locks after normalizing. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MOMENT_LENGTH)
  context!: string;
}
