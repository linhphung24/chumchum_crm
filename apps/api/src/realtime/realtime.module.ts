import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { InternalBusService } from './internal-bus.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'dev-secret',
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '1d') as never },
      }),
    }),
  ],
  providers: [EventsGateway, InternalBusService],
  exports: [EventsGateway, InternalBusService],
})
export class RealtimeModule {}
