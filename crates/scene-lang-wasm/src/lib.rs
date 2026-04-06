use std::cell::RefCell;
use std::str;

use scene_lang_worker_core::{
    code_actions_payload, compile_json_payload, diagnostics_json_payload, format_json_payload,
    highlights_json_payload, hover_json_payload,
};

thread_local! {
    static LAST_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_last_result(result: Vec<u8>) {
    LAST_RESULT.with(|slot| {
        *slot.borrow_mut() = result;
    });
}

fn with_last_result() -> *const u8 {
    LAST_RESULT.with(|slot| slot.borrow().as_ptr())
}

fn with_last_result_len() -> usize {
    LAST_RESULT.with(|slot| slot.borrow().len())
}

fn set_last_json(payload: String) {
    let mut bytes = payload.into_bytes();
    set_last_result(std::mem::take(&mut bytes));
}

fn read_input(source_ptr: *const u8, source_len: usize) -> Option<String> {
    if source_ptr.is_null() || source_len == 0 {
        return Some(String::new());
    }

    let bytes = unsafe { std::slice::from_raw_parts(source_ptr, source_len) };
    match str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        Err(_) => None,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut bytes = Vec::with_capacity(len);
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        let _ = Vec::from_raw_parts(ptr, len, len);
    };
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_compile(source_ptr: *const u8, source_len: usize) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    set_last_json(compile_json_payload(&source));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_diagnostics_json(source_ptr: *const u8, source_len: usize) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    set_last_json(diagnostics_json_payload(&source));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_hover_json(source_ptr: *const u8, source_len: usize, offset: usize) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    set_last_json(hover_json_payload(&source, offset));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_format_json(source_ptr: *const u8, source_len: usize) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    set_last_json(format_json_payload(&source));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_code_actions_json(
    source_ptr: *const u8,
    source_len: usize,
    from: usize,
    to: usize,
) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    let mut safe_from = from.min(source.len());
    let mut safe_to = to.min(source.len());
    if safe_to < safe_from {
        std::mem::swap(&mut safe_from, &mut safe_to);
    }

    set_last_json(code_actions_payload(&source, safe_from, safe_to));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn scene_highlights_json(
    source_ptr: *const u8,
    source_len: usize,
    from_line: usize,
    to_line: usize,
) -> i32 {
    let source = match read_input(source_ptr, source_len) {
        Some(value) => value,
        None => return -1,
    };

    set_last_json(highlights_json_payload(&source, from_line, to_line));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn last_result_ptr() -> *const u8 {
    with_last_result()
}

#[unsafe(no_mangle)]
pub extern "C" fn last_result_len() -> usize {
    with_last_result_len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy_to_wasm_memory(input: &str) -> (*const u8, usize) {
        let bytes = input.as_bytes();
        let ptr = alloc(bytes.len());
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        }
        (ptr.cast(), bytes.len())
    }

    #[test]
    fn scene_compile_populates_last_result_with_json() {
        let source = r#"shader
vertex
  position fullscreen
fragment
  color
    r 0.5
    g 0.5
    b 0.5
    a 1.0
"#;
        let (ptr, len) = copy_to_wasm_memory(source);
        let status = scene_compile(ptr, len);
        dealloc(ptr as *mut u8, len);
        assert_eq!(status, 0);
        let payload = unsafe {
            let bytes = std::slice::from_raw_parts(last_result_ptr(), last_result_len());
            std::str::from_utf8(bytes).expect("utf8 compile payload")
        };
        assert!(payload.contains("\"ok\":true"));
    }
}
