package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class LightroomApiExceptionTest {

    @Test
    void messageConstructorSetsMessage() {
        LightroomApiException ex = new LightroomApiException("something went wrong");
        assertThat(ex.getMessage()).isEqualTo("something went wrong");
        assertThat(ex.getCause()).isNull();
    }

    @Test
    void messageCauseConstructorSetsBoth() {
        RuntimeException cause = new RuntimeException("root cause");
        LightroomApiException ex = new LightroomApiException("wrapper", cause);
        assertThat(ex.getMessage()).isEqualTo("wrapper");
        assertThat(ex.getCause()).isSameAs(cause);
    }
}
