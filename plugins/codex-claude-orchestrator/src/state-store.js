import fs from "node:fs/promises";
import path from "node:path";
import { now } from "./schema.js";

export class StateStore {
  constructor(config) {
    this.config = config;
    this.file = path.resolve(config.cwd, config.stateFile);
    this.state = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = { version: 1, project: { cwd: this.config.cwd }, tasks: {}, agents: {}, events: [] };
    }
    return this.state;
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2));
    await fs.rename(temp, this.file);
    return this.state;
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      await this.load();
      const value = await mutator(this.state);
      this.state.updatedAt = now();
      await this.save();
      return value === undefined ? this.state : value;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async event(type, payload = {}) {
    return this.update((state) => {
      const event = { id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, type, at: now(), ...payload };
      state.events.push(event);
      if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
      return event;
    });
  }
}
