import { TaskContract } from '../contract/types';
import { scoped } from '../log';

const regLog = scoped('registry');

export type TaskHandler<Args extends any[] = any[], Result = any> =
  (...args: Args) => Result | Promise<Result>;

interface RegisteredTask {
  contract: TaskContract;
  handler: TaskHandler;
}

export class TaskRegistry {
  private static tasks: Map<string, RegisteredTask> = new Map();

  public static register<Args extends any[], Result>(
    contract: TaskContract<Args, Result>,
    handler: TaskHandler<Args, Result>
  ): void {
    this.tasks.set(contract.taskId, { contract, handler });
    regLog.debug(`registered "${contract.taskId}"`, {
      args: contract.argsSchema ? 'validated' : 'unvalidated',
      result: contract.resultSchema ? 'validated' : 'unvalidated',
    });
  }

  public static getContract(taskId: string): TaskContract | undefined {
    return this.tasks.get(taskId)?.contract;
  }

  public static async execute(taskId: string, ...args: any[]): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task handler not found for id: ${taskId}`);
    }
    const { contract, handler } = task;
    const validatedArgs = contract.argsSchema ? contract.argsSchema.parse(args) : args;
    const result = await handler(...validatedArgs);
    return contract.resultSchema ? contract.resultSchema.parse(result) : result;
  }
}
