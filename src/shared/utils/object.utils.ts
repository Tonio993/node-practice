export function omit<T extends object>(obj: T, keys: string[]): Partial<T> {
        const result = { ...obj };
        keys.forEach(key => delete (result as any)[key]);
        return result;
    }