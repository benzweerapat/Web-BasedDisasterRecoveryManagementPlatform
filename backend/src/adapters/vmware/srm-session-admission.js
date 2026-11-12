// FIFO admission for owned local sessions. This queue never submits a VMware
// request: the adapter prepares/validates a waiter and reserves its slot.
class SrmSessionAdmission {
  constructor({ maxPending = 32 } = {}) {
    this.waiters = [];
    this.pumping = false;
    this.maxPending = maxPending;
  }

  get pendingCount() { return this.waiters.length; }

  acquire({ prepare, reserve, timeoutMs, busyError }) {
    if (this.waiters.length >= this.maxPending) return Promise.reject(busyError());
    return new Promise((resolve, reject) => {
      const waiter = { prepare, reserve, resolve, reject, active: true, deadline: Date.now() + timeoutMs };
      const expire = () => {
        if (!waiter.active) return;
        this.finish(waiter, busyError());
        this.notify();
      };
      waiter.expire = expire;
      waiter.timer = setTimeout(expire, timeoutMs);
      this.waiters.push(waiter);
      this.notify();
    });
  }

  finish(waiter, error, reservation) {
    if (!waiter.active) return;
    waiter.active = false;
    clearTimeout(waiter.timer);
    const index = this.waiters.indexOf(waiter);
    if (index !== -1) this.waiters.splice(index, 1);
    if (error) waiter.reject(error);
    else waiter.resolve(reservation);
  }

  async notify() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length) {
        const waiter = this.waiters[0];
        try {
          // Failed owned logout reconciliation may await. Reserve only after
          // it completes and recheck the deadline before touching capacity.
          await waiter.prepare();
          if (!waiter.active) continue;
          if (Date.now() >= waiter.deadline) { waiter.expire(); continue; }
          const reservation = waiter.reserve();
          if (!reservation) return; // Wake on owned logout or opening release.
          this.finish(waiter, null, reservation);
        } catch (error) {
          this.finish(waiter, error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}

module.exports = { SrmSessionAdmission };
