/**
 * Version the running hub reports. The packaged build and the selected release
 * bake `CLARA_VERSION` in; the supervised local stack passes it from the
 * command. The constant is the fallback for a hub started on its own.
 */
export const SERVER_VERSION = process.env.CLARA_VERSION?.trim() || '0.1.0'
