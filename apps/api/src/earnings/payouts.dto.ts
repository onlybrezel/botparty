import { IsString, MaxLength } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @MaxLength(1000)
  declare reason: string;
}

export class MarkPaidPayoutDto {
  @IsString()
  @MaxLength(192)
  declare providerRef: string;
}
