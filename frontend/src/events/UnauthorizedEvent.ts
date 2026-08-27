/**
 * Custom event dispatched when a 401 Unauthorized response is received.
 * Contains the next URL where the user should be redirected after login.
 */
export class UnauthorizedEvent extends Event {
  static readonly EVENT_NAME = 'auth:unauthorized';

  constructor(public readonly nextUrl: string) {
    super(UnauthorizedEvent.EVENT_NAME, {
      bubbles: true,
      cancelable: false,
    });
  }
}
