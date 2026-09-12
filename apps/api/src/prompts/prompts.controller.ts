import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type {
  ComposePromptResponse,
  IfmDiagnosticsDto,
  ShelfCopyResponse,
} from '@stashd/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComposePromptDto } from './dto/compose-prompt.dto';
import { ShelfCopyDto } from './dto/shelf-copy.dto';
import { PromptsService } from './prompts.service';

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Post('compose')
  compose(@Body() body: ComposePromptDto): Promise<ComposePromptResponse> {
    return this.prompts.compose(body);
  }

  /** K2 rewrites the shelf cards the client built from timing, weather and calendars. */
  @Post('shelf')
  async shelf(@Body() body: ShelfCopyDto): Promise<ShelfCopyResponse> {
    const items = await this.prompts.shelfCopy(body.items);
    return { items, ifm: this.prompts.diagnostics() };
  }

  @Get('ifm')
  ifm(): IfmDiagnosticsDto {
    return this.prompts.diagnostics();
  }
}
