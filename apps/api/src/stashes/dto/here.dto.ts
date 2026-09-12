import { CONTEXTS, LockContext } from '@stashd/shared';
import { IsIn } from 'class-validator';

export class HereDto {
  @IsIn([...CONTEXTS])
  context!: LockContext;
}
