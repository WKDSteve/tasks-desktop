//! The hub's own client (`appkit_hub::client::request`) with the patience of a test against the real engine.
//!
//! That client gives up after 5 s: right for a program that asks a hub who it is, too short for a test whose hub
//! starts the real tasks engine (Neovim) for an upload or a write on a runner that shares the PC with 15 others. A
//! request is not repeated (an upload twice is a different test): this one waits up to [`TIMEOUT`] for the one
//! answer and reads it like the hub's client does, into the same [`Reply`].

use std::io;
use std::time::Duration;

pub use appkit_hub::client::Reply;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// How long a test waits for the hub's answer: the engine's own limits end a call that hangs long before.
pub const TIMEOUT: Duration = Duration::from_secs(60);
const MAX_REPLY_BYTES: usize = 1024 * 1024;

/// Sends one request to the hub on `port` (127.0.0.1) and waits up to [`TIMEOUT`] for the reply.
///
/// # Errors
///
/// I/O errors, a time-out, a reply over 1 MiB or not HTTP.
pub async fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> io::Result<Reply> {
    request_within(TIMEOUT, port, method, path, headers, body).await
}

/// [`request`] with a limit of the caller's.
///
/// # Errors
///
/// As [`request`].
pub async fn request_within(
    limit: Duration,
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> io::Result<Reply> {
    let mut text = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n");
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    text.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ));
    let exchange = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
        stream.write_all(text.as_bytes()).await?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            if buf.len() + n > MAX_REPLY_BYTES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "the reply is larger than expected",
                ));
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        Ok::<_, io::Error>(buf)
    };
    let bytes = tokio::time::timeout(limit, exchange).await.map_err(|_| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            format!("the hub did not answer within {} s", limit.as_secs()),
        )
    })??;
    parse(&bytes)
}

fn parse(bytes: &[u8]) -> io::Result<Reply> {
    let bad = || io::Error::new(io::ErrorKind::InvalidData, "not an HTTP reply");
    let text = std::str::from_utf8(bytes).map_err(|_| bad())?;
    let (head, body) = text.split_once("\r\n\r\n").ok_or_else(bad)?;
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(bad)?;
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect();
    Ok(Reply {
        status,
        headers,
        body: body.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// A hub that answers after `delay`, once.
    async fn slow_hub(delay: Duration) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut chunk = [0u8; 1024];
            let _ = stream.read(&mut chunk).await;
            tokio::time::sleep(delay).await;
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nX-Slow: yes\r\nContent-Length: 2\r\n\r\n{}")
                .await;
        });
        port
    }

    #[tokio::test]
    async fn a_hub_slower_than_the_hubs_own_client_still_answers() {
        // Longer than the 5 s of appkit_hub::client: that client says "the hub did not answer" here.
        let port = slow_hub(Duration::from_millis(5_500)).await;
        let reply = request(port, "GET", "/x", &[], "").await.unwrap();
        assert_eq!((reply.status, reply.body.as_str()), (200, "{}"));
        assert_eq!(reply.header("x-slow"), Some("yes"));
    }

    #[tokio::test]
    async fn a_hub_that_never_answers_is_a_time_out_with_the_limit() {
        let port = slow_hub(Duration::from_secs(30)).await;
        let err = request_within(Duration::from_millis(200), port, "GET", "/x", &[], "")
            .await
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(err.to_string().contains("within 0 s"), "{err}");
    }

    #[test]
    fn nonsense_is_not_a_reply() {
        assert!(parse(b"").is_err());
        assert!(parse(b"HTTP/1.1 abc\r\n\r\n").is_err());
    }
}
