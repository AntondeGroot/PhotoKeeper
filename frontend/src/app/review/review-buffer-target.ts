/**
 * How many review units to keep queued up ahead of the user.
 *
 * Lives on its own, apart from the service that owns the queue, because two parts of the app have
 * to agree on it: the review buffer fills to this number, and the background detection scan has to
 * put at least this much unreviewed material on the device for it to draw from. When they held
 * separate numbers the smaller one silently won, and the queue could never fill.
 *
 * Metadata only, so the cost of holding them is trivial — previews are fetched for the front of the
 * queue alone.
 */
export const REVIEW_BUFFER_TARGET = 200;
