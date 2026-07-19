import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTransactionsQueryDto } from './wallet.dto';

describe('ListTransactionsQueryDto', () => {
  it('converts an HTTP query-string limit to a validated number', async () => {
    const query = plainToInstance(ListTransactionsQueryDto, { limit: '50' });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.limit).toBe(50);
  });

  it('rejects limits outside the documented range', async () => {
    const query = plainToInstance(ListTransactionsQueryDto, { limit: '201' });

    const errors = await validate(query);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('max');
  });
});
