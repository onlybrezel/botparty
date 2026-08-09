import { QueueObservabilityService } from './queue-observability.service';

describe('QueueObservabilityService', () => {
  it('collects all worker queue states without consuming jobs', async () => {
    const queue = {
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 2,
        delayed: 1,
        prioritized: 0,
        'waiting-children': 0,
        active: 1,
        failed: 0,
      }),
    };
    const service = new QueueObservabilityService(queue, queue, queue);

    await service.collect();

    expect(queue.getJobCounts).toHaveBeenCalledTimes(3);
    expect(queue.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'delayed',
      'prioritized',
      'waiting-children',
      'active',
      'failed',
    );
  });
});
