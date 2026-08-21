package com.photokeeper.service;

/**
 * Adobe refused the refresh token itself — expired, revoked, or already spent on a rotation.
 *
 * Distinct from every other refresh failure on purpose. IMS being slow, the network dropping, or
 * this backend restarting mid-deploy are all recoverable, and the device must keep its credentials
 * and try again. This one is not recoverable: only signing in to Adobe again produces a working
 * token, so it is the single case that costs the user their session.
 */
public class RefreshTokenRejectedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public RefreshTokenRejectedException(String message) {
        super(message);
    }

    public RefreshTokenRejectedException(String message, Throwable cause) {
        super(message, cause);
    }
}
