/**
 * Lets a worker service queued messages before continuing a long calculation.
 * A timer is heavily throttled in some embedded browser realms, so prefer a
 * posted message task and close its ports as soon as it has run.
 */
export function yieldWorkerTask(): Promise<void> {
  if (typeof MessageChannel === "undefined")
    return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    };
    channel.port1.onmessage = () => {
      close();
      resolve();
    };
    try {
      channel.port2.postMessage(undefined);
    } catch (error) {
      close();
      reject(error);
    }
  });
}
