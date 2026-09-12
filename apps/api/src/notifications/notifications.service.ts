import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  AlertDraftDto,
  AlertPreviewDto,
  CurationSource,
  NotificationsStatusDto,
  PromptCopySource,
  PushSubscriptionDto,
  SendAlertNowResponse,
  StashAlertDto,
} from '@stashd/shared';
import { Model } from 'mongoose';
import * as webpush from 'web-push';
import { FriendshipsService } from '../friendships/friendships.service';
import { GroupsService } from '../groups/groups.service';
import { PromptsService } from '../prompts/prompts.service';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { HappeningsService, SchoolHappening } from './happenings.service';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';
import { StashAlert, StashAlertDocument } from './schemas/stash-alert.schema';

/** Hours (UTC) during which we never wake a phone. Roughly overnight for US campuses. */
const QUIET_HOURS_UTC = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const MIN_GAP_MS = 1000 * 60 * 60 * 3;
const RECENT_CUE_WINDOW_DAYS = 7;

export function dayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Hard daily ceiling on device alerts.
 * >4 friends+groups → 3 or 4 (alternates by day so it never feels like a schedule).
 * Small graphs get at most 2 — there is less to say, so we say less.
 */
export function dailyAlertBudget(
  friendCount: number,
  groupCount: number,
  day = dayStamp(),
): number {
  const social = friendCount + groupCount;
  if (social <= 0) return 0;
  if (social <= 4) return 2;
  return hashString(day) % 2 === 0 ? 3 : 4;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pushConfigured: boolean;

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    @InjectModel(StashAlert.name)
    private readonly alertModel: Model<StashAlertDocument>,
    private readonly usersService: UsersService,
    private readonly friendshipsService: FriendshipsService,
    private readonly groupsService: GroupsService,
    private readonly promptsService: PromptsService,
    private readonly happenings: HappeningsService,
  ) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:hello@stashd.app';
    this.pushConfigured = Boolean(publicKey && privateKey);
    if (this.pushConfigured) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    } else {
      this.logger.warn(
        'VAPID keys missing — stash alerts will be stored but not pushed. Run `npx web-push generate-vapid-keys`.',
      );
    }
  }

  async status(user: UserDocument): Promise<NotificationsStatusDto> {
    const [friends, groups, sentToday, pending] = await Promise.all([
      this.friendshipsService.listFriends(user),
      this.groupsService.list(user),
      this.alertModel.countDocuments({ userId: user._id, day: dayStamp() }),
      this.alertModel
        .find({ userId: user._id, acknowledged: false })
        .sort({ createdAt: -1 })
        .limit(4)
        .exec(),
    ]);
    const friendCount = friends.filter((f) => !f.isSelf).length;
    return {
      enabled: Boolean(user.stashAlertsEnabled),
      pushConfigured: this.pushConfigured,
      vapidPublicKey: this.pushConfigured
        ? process.env.VAPID_PUBLIC_KEY
        : undefined,
      sentToday,
      dailyBudget: dailyAlertBudget(friendCount, groups.length),
      pending: pending.map((doc) => this.toDto(doc)),
      ifm: this.promptsService.diagnostics(),
    };
  }

  async saveSubscription(
    user: UserDocument,
    body: PushSubscriptionDto,
  ): Promise<void> {
    await this.subscriptionModel.updateOne(
      { endpoint: body.endpoint },
      {
        $set: {
          userId: user._id,
          keys: body.keys,
          expirationTime: body.expirationTime ?? null,
        },
      },
      { upsert: true },
    );
  }

  async removeSubscription(user: UserDocument, endpoint?: string): Promise<void> {
    if (endpoint) {
      await this.subscriptionModel.deleteOne({ userId: user._id, endpoint });
    } else {
      await this.subscriptionModel.deleteMany({ userId: user._id });
    }
  }

  async acknowledge(user: UserDocument, alertId: string): Promise<void> {
    await this.alertModel.updateOne(
      { _id: alertId, userId: user._id },
      { $set: { acknowledged: true } },
    );
  }

  /**
   * The user asked for one right now (demo / "send me a test"). A manual
   * send is never spam, so it ignores the gap, quiet hours and the cap — but
   * it still counts toward today's budget, so the cron sends fewer later.
   * With a `draft`, we send exactly what the preview showed.
   */
  async sendNow(
    user: UserDocument,
    draft?: AlertDraftDto,
  ): Promise<SendAlertNowResponse> {
    return this.deliverForUser(user, { manual: true, draft });
  }

  /**
   * Dry run: what would today's alerts look like for this user? Composes up
   * to the daily budget without storing, pushing, or spending anything —
   * this is what the in-app preview and laptop demos use. Without a `seed`
   * this is today's actual plan; with one, friends and cues reshuffle.
   */
  async preview(user: UserDocument, seed?: string): Promise<AlertPreviewDto> {
    const now = new Date();
    const day = dayStamp(now);
    const salt = seed ? `${day}:${seed}` : day;
    // The preview doubles as the IFM check-up, so make sure the model list is fresh.
    await this.promptsService.listModels();
    const [friends, groups, sentToday] = await Promise.all([
      this.friendshipsService.listFriends(user),
      this.groupsService.list(user),
      this.alertModel.countDocuments({ userId: user._id, day }),
    ]);
    const others = friends.filter((f) => !f.isSelf);
    const budget = dailyAlertBudget(others.length, groups.length, day);

    const alerts: StashAlertDto[] = [];
    const usedCues = new Set<string>();
    const usedFriends = new Set<string>();
    const candidates = this.rankFriends(others, usedFriends, salt);

    let guard = 0;
    while (alerts.length < budget && guard < budget * 3) {
      guard += 1;
      const friend =
        candidates.find((f) => !usedFriends.has(f.id)) ??
        candidates[alerts.length % Math.max(1, candidates.length)];
      if (!friend) break;
      const built = await this.buildAlert(user, friend, usedCues, `${salt}:${alerts.length}`);
      usedFriends.add(friend.id);
      if (!built) {
        if (usedFriends.size >= candidates.length) break;
        continue;
      }
      usedCues.add(built.sourceLabel + '|' + built.cue);
      alerts.push({
        id: `preview-${alerts.length}`,
        title: built.title,
        body: built.body,
        kind: built.kind,
        friendId: friend.id,
        friendName: friend.displayName,
        schoolId: built.schoolId,
        schoolName: built.schoolName,
        sourceLabel: built.sourceLabel,
        sourceUrl: built.sourceUrl,
        suggestedCondition: built.suggestedCondition,
        copySource: built.copySource,
        curationSource: built.curationSource,
        createdAt: now.toISOString(),
      });
    }

    return {
      dailyBudget: budget,
      sentToday,
      friendCount: others.length,
      groupCount: groups.length,
      alerts,
      ifm: this.promptsService.diagnostics(),
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    const users = await this.usersService.listAlertOptIns();
    if (users.length === 0) return;
    this.logger.log(`Alert tick for ${users.length} opted-in user(s)`);
    for (const user of users) {
      try {
        await this.deliverForUser(user, { manual: false });
      } catch (err) {
        this.logger.warn(
          `Alert failed for ${user._id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
  }

  private async deliverForUser(
    user: UserDocument,
    opts: { manual: boolean; draft?: AlertDraftDto },
  ): Promise<SendAlertNowResponse> {
    const now = new Date();
    const day = dayStamp(now);
    const scheduled = !opts.manual;

    if (scheduled && QUIET_HOURS_UTC.has(now.getUTCHours())) {
      return { alert: null };
    }

    const [friends, groups] = await Promise.all([
      this.friendshipsService.listFriends(user),
      this.groupsService.list(user),
    ]);
    const others = friends.filter((f) => !f.isSelf);
    const budget = dailyAlertBudget(others.length, groups.length, day);
    if (budget === 0) return { alert: null, reason: 'no-friends' };

    const todays = await this.alertModel
      .find({ userId: user._id, day })
      .sort({ createdAt: -1 })
      .exec();
    if (scheduled && todays.length >= budget) return { alert: null };

    const last = todays[0];
    const lastAt = last
      ? new Date((last as unknown as { createdAt: Date }).createdAt).getTime()
      : 0;
    if (scheduled && now.getTime() - lastAt < MIN_GAP_MS) {
      return { alert: null };
    }

    // Spread the remaining budget across the awake window so alerts don't cluster.
    if (scheduled) {
      const awakeHours = 24 - QUIET_HOURS_UTC.size;
      const slot = Math.max(1, Math.floor(awakeHours / budget));
      const hourIndex = this.awakeHourIndex(now.getUTCHours());
      if (hourIndex % slot !== 0) return { alert: null };
    }

    if (opts.draft) {
      const friend = others.find((f) => f.id === opts.draft?.friendId);
      if (friend) {
        return { alert: await this.store(user, day, { ...opts.draft, friendName: friend.displayName }) };
      }
      // A stale preview (friend removed since) falls through to a fresh compose.
    }

    const since = new Date(now.getTime() - RECENT_CUE_WINDOW_DAYS * 86_400_000);
    const recent = await this.alertModel
      .find({ userId: user._id, createdAt: { $gte: since } })
      .exec();
    const usedCues = new Set(recent.map((a) => a.sourceLabel + '|' + a.title));
    const usedFriendsToday = new Set(todays.map((a) => a.friendId));

    const candidates = this.rankFriends(others, usedFriendsToday, day);
    if (candidates.length === 0) return { alert: null, reason: 'no-friends' };

    // Manual sends get a different shuffle each time so a demo never repeats itself.
    const salt = opts.manual ? `${day}:${now.getTime()}` : day;

    for (const friend of candidates) {
      const built = await this.buildAlert(
        user,
        friend,
        usedCues,
        `${salt}:${user._id}:${friend.id}`,
      );
      if (!built) continue;
      return {
        alert: await this.store(user, day, {
          title: built.title,
          body: built.body,
          kind: built.kind,
          friendId: friend.id,
          friendName: friend.displayName,
          schoolId: built.schoolId,
          schoolName: built.schoolName,
          sourceLabel: built.sourceLabel,
          sourceUrl: built.sourceUrl,
          suggestedCondition: built.suggestedCondition,
          copySource: built.copySource,
          curationSource: built.curationSource,
        }),
      };
    }
    return { alert: null, reason: 'no-cues' };
  }

  /** Persist one alert (spending budget) and push it to every subscribed device. */
  private async store(
    user: UserDocument,
    day: string,
    draft: AlertDraftDto,
  ): Promise<StashAlertDto> {
    const doc = await this.alertModel.create({
      userId: user._id,
      day,
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      friendId: draft.friendId,
      friendName: draft.friendName,
      schoolId: draft.schoolId,
      schoolName: draft.schoolName,
      sourceLabel: draft.sourceLabel,
      sourceUrl: draft.sourceUrl,
      suggestedCondition: draft.suggestedCondition,
      copySource: draft.copySource,
      curationSource: draft.curationSource,
      deliveredPush: false,
      acknowledged: false,
    });

    const delivered = await this.push(user._id, doc);
    if (delivered) {
      doc.deliveredPush = true;
      await doc.save();
    }
    return this.toDto(doc);
  }

  /** Friends at a known school first, rotating who leads each day. */
  private rankFriends<T extends { id: string; schoolId?: string }>(
    friends: T[],
    alreadyPingedToday: Set<string | undefined>,
    day: string,
  ): T[] {
    return friends
      .filter((f) => Boolean(this.happenings.schoolMeta(f.schoolId)))
      .sort((a, b) => {
        const aUsed = alreadyPingedToday.has(a.id) ? 1 : 0;
        const bUsed = alreadyPingedToday.has(b.id) ? 1 : 0;
        if (aUsed !== bUsed) return aUsed - bUsed;
        return hashString(`${day}:${a.id}`) - hashString(`${day}:${b.id}`);
      });
  }

  private async buildAlert(
    user: UserDocument,
    friend: { id: string; displayName: string; schoolId?: string },
    usedCues: Set<string>,
    seed: string,
  ): Promise<
    | (SchoolHappening & {
        title: string;
        body: string;
        schoolId: string;
        schoolName: string;
        suggestedCondition: string;
        copySource: PromptCopySource;
        curationSource: CurationSource;
      })
    | null
  > {
    const schoolId = friend.schoolId;
    const meta = this.happenings.schoolMeta(schoolId);
    if (!schoolId || !meta) return null;
    const items = await this.happenings.happeningsForSchool(schoolId);
    const pick = this.pickHappening(items, usedCues, `${seed}:${user._id}`);
    if (!pick) return null;

    const composed = await this.promptsService.compose({
      schoolId,
      schoolName: meta.name,
      cue: pick.cue,
      emotion: pick.emotion,
      recipientName: friend.displayName,
    });

    return {
      ...pick,
      title: composed.title,
      body: composed.body,
      schoolId,
      schoolName: meta.name,
      suggestedCondition: this.conditionFor(pick),
      copySource: composed.source,
      curationSource: pick.curatedBy,
    };
  }

  private awakeHourIndex(utcHour: number): number {
    let index = 0;
    for (let h = 0; h < 24; h += 1) {
      if (QUIET_HOURS_UTC.has(h)) continue;
      if (h === utcHour) return index;
      index += 1;
    }
    return 0;
  }

  private pickHappening(
    items: SchoolHappening[],
    usedCues: Set<string>,
    seed: string,
  ): SchoolHappening | null {
    const fresh = items.filter(
      (item) => !usedCues.has(item.sourceLabel + '|' + item.cue),
    );
    if (fresh.length === 0) return null;
    // Rotate kinds so a user isn't hit with three athletics alerts in a row.
    const order: SchoolHappening['kind'][] = [
      'athletics',
      'event',
      'tradition',
      'food',
      'news',
    ];
    const hash = hashString(seed);
    const start = hash % order.length;
    for (let i = 0; i < order.length; i += 1) {
      const kind = order[(start + i) % order.length];
      // Items arrive best-first (K2's score when it curated), so vary among the
      // top few rather than the whole list: a reshuffle changes the cue without
      // dropping to the weakest one.
      const matches = fresh.filter((item) => item.kind === kind);
      if (matches.length > 0) {
        return matches[Math.floor(hash / 7) % Math.min(3, matches.length)];
      }
    }
    return fresh[hash % fresh.length];
  }

  private conditionFor(item: SchoolHappening): string {
    switch (item.kind) {
      case 'athletics':
        return 'Open after the game';
      case 'food':
        return 'Open when you eat something good';
      case 'tradition':
        return 'Open when you remember this place';
      case 'event':
        return 'Open when you get home tonight';
      default:
        return 'Open when you need a lift';
    }
  }

  private async push(userId: string, alert: StashAlertDocument): Promise<boolean> {
    if (!this.pushConfigured) return false;
    const subs = await this.subscriptionModel.find({ userId }).exec();
    if (subs.length === 0) return false;

    const payload = JSON.stringify({
      alertId: String(alert._id),
      title: alert.title,
      body: alert.body,
      friendId: alert.friendId,
      friendName: alert.friendName,
      suggestedCondition: alert.suggestedCondition,
      sourceUrl: alert.sourceUrl,
      tag: `stashd-alert-${alert.day}`,
    });

    let delivered = false;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys,
            },
            payload,
            { TTL: 60 * 60 * 6 },
          );
          delivered = true;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.subscriptionModel.deleteOne({ _id: sub._id });
          } else {
            this.logger.warn(
              `Push failed (${status ?? 'n/a'}) for ${userId}: ${err instanceof Error ? err.message : 'unknown'}`,
            );
          }
        }
      }),
    );
    return delivered;
  }

  private toDto(doc: StashAlertDocument): StashAlertDto {
    const createdAt = (doc as unknown as { createdAt?: Date }).createdAt;
    return {
      id: String(doc._id),
      title: doc.title,
      body: doc.body,
      kind: doc.kind,
      friendId: doc.friendId,
      friendName: doc.friendName,
      schoolId: doc.schoolId,
      schoolName: doc.schoolName,
      sourceLabel: doc.sourceLabel,
      sourceUrl: doc.sourceUrl,
      suggestedCondition: doc.suggestedCondition,
      createdAt: (createdAt ?? new Date()).toISOString(),
      deliveredPush: Boolean(doc.deliveredPush),
      copySource: doc.copySource,
      curationSource: doc.curationSource,
    };
  }
}
