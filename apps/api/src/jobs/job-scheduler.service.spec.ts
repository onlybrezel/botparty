import { JobSchedulerService } from './job-scheduler.service';

describe('JobSchedulerService', () => {
  it('atomically upserts one deterministic scheduler from every API instance', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue({ id: 'next-job' }) };
    const firstInstance = new JobSchedulerService(queue as never);
    const secondInstance = new JobSchedulerService(queue as never);

    await Promise.all([firstInstance.onModuleInit(), secondInstance.onModuleInit()]);

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      'audit-log-cleanup',
      { pattern: '0 2 * * *' },
      { name: 'audit-log-cleanup', data: {} },
    );
    expect(queue.upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      'audit-log-cleanup',
      { pattern: '0 2 * * *' },
      { name: 'audit-log-cleanup', data: {} },
    );
  });
});
