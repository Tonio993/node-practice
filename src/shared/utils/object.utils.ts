export function omit<T extends object>(obj: T, keys: string[]): Partial<T> {
    const result = { ...obj };
    keys.forEach(key => delete (result as any)[key]);
    return result;
}

export function renameKeys(obj: Record<string, unknown>, keyMapper: (key: string) => string, deepMap: boolean = true): Record<string, unknown> {
    if (!isPlainObject(obj) && !Array.isArray(obj)) return obj;
    const result: any = {};
    for (const key in obj) {
        let value
        if (deepMap && isPlainObject(obj[key])) {
            value = renameKeys(obj[key] as Record<string, unknown>, keyMapper, deepMap)
        } else if (deepMap && Array.isArray(obj[key])) {
            value = obj[key].map(item => renameKeys(item, keyMapper, deepMap))
        } else {
            value = obj[key]
        }
        result[keyMapper(key)] = value
    }
    return result
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        value.constructor === Object
    );
}