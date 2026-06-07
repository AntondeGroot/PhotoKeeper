package com.photokeeper.service;

public class LightroomApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public LightroomApiException(String message) {
        super(message);
    }

    public LightroomApiException(String message, Throwable cause) {
        super(message, cause);
    }
}
