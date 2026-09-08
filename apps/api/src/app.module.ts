import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ChannelsModule } from './channels/channels.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CommentsModule } from './comments/comments.module';
import { OrdersModule } from './orders/orders.module';
import { TrelloModule } from './trello/trello.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DomainsModule } from './domains/domains.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DevModule } from './dev/dev.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    ConversationsModule,
    ChannelsModule,
    WebhooksModule,
    CommentsModule,
    OrdersModule,
    TrelloModule,
    AnalyticsModule,
    NotificationsModule,
    DomainsModule,
    RealtimeModule,
    DevModule,
    JobsModule,
  ],
})
export class AppModule {}
