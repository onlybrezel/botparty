import { IsIn, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsIn(['stripe', 'paypal'])
  provider!: 'stripe' | 'paypal';

  @IsString()
  @MaxLength(64)
  packageId!: string;
}
