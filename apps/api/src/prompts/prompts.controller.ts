import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { ComposePromptResponse } from '@stashd/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComposePromptDto } from './dto/compose-prompt.dto';
import { PromptsService } from './prompts.service';

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Post('compose')
  compose(@Body() body: ComposePromptDto): Promise<ComposePromptResponse> {
    return this.prompts.compose(body);
  }
}
