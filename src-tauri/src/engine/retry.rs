pub const MAX_ATTEMPTS: u32 = 4;

pub fn is_http_403(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("http error 403") || lower.contains("403: forbidden")
}

pub fn should_retry(attempts_completed: u32, output: &str) -> bool {
    attempts_completed > 0 && attempts_completed < MAX_ATTEMPTS && is_http_403(output)
}

#[cfg(test)]
mod tests {
    use super::{is_http_403, should_retry};

    #[test]
    fn detects_403_phrases_ignoring_case() {
        assert!(is_http_403("ERROR: HTTP Error 403: Forbidden"));
        assert!(is_http_403("http error 403"));
        assert!(is_http_403("403: forbidden"));
        assert!(is_http_403("403: Forbidden"));
        assert!(!is_http_403("HTTP Error 404: Not Found"));
        assert!(!is_http_403("got 403 from somewhere"));
        assert!(!is_http_403("video unavailable"));
    }

    #[test]
    fn retries_three_times_on_403_then_stops() {
        let outputs = [
            "http error 403",
            "HTTP Error 403: Forbidden",
            "403: Forbidden",
            "http error 403",
            "http error 403",
        ];
        let mut attempts = 0u32;
        for output in outputs {
            attempts += 1;
            if !should_retry(attempts, output) {
                break;
            }
        }
        assert_eq!(attempts, 4);
        assert!(should_retry(1, "http error 403"));
        assert!(should_retry(2, "http error 403"));
        assert!(should_retry(3, "http error 403"));
        assert!(!should_retry(4, "http error 403"));
    }

    #[test]
    fn stops_early_when_not_403() {
        let outputs = ["http error 403", "video unavailable", "http error 403"];
        let mut attempts = 0u32;
        for output in outputs {
            attempts += 1;
            if !should_retry(attempts, output) {
                break;
            }
        }
        assert_eq!(attempts, 2);
        assert!(!should_retry(1, "private video"));
    }
}
