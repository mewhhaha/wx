use scene_lang_core::{SceneRenderModel, Severity, build_render_model};

fn push_u32_leb(bytes: &mut Vec<u8>, mut value: u32) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn push_i32_leb(bytes: &mut Vec<u8>, mut value: i32) {
    loop {
        let byte = (value as u8) & 0x7f;
        value >>= 7;
        let sign_bit_set = (byte & 0x40) != 0;
        let done = (value == 0 && !sign_bit_set) || (value == -1 && sign_bit_set);

        if done {
            bytes.push(byte);
            break;
        }

        bytes.push(byte | 0x80);
    }
}

fn push_name(bytes: &mut Vec<u8>, name: &str) {
    push_u32_leb(bytes, name.len() as u32);
    bytes.extend_from_slice(name.as_bytes());
}

fn encode_vec_section(section_id: u8, payload: Vec<u8>, out: &mut Vec<u8>) {
    out.push(section_id);
    push_u32_leb(out, payload.len() as u32);
    out.extend_from_slice(&payload);
}

#[derive(Clone, Copy)]
enum OpCode {
    End = 0x0b,
    Call = 0x10,
    LocalGet = 0x20,
    I32Const = 0x41,
    I32Add = 0x6a,
    I32Sub = 0x6b,
}

fn emit_i32_const(body: &mut Vec<u8>, value: i32) {
    body.push(OpCode::I32Const as u8);
    push_i32_leb(body, value);
}

fn emit_local_get(body: &mut Vec<u8>, index: u32) {
    body.push(OpCode::LocalGet as u8);
    push_u32_leb(body, index);
}

fn emit_call(body: &mut Vec<u8>, function_index: u32) {
    body.push(OpCode::Call as u8);
    push_u32_leb(body, function_index);
}

fn emit_fill_screen(body: &mut Vec<u8>) {
    emit_i32_const(body, 0);
    emit_i32_const(body, 0);
    emit_local_get(body, 0);
    emit_local_get(body, 1);
    emit_i32_const(body, ' ' as i32);
    emit_i32_const(body, 0);
    emit_call(body, 0);
}

fn emit_put_cell(body: &mut Vec<u8>, x: i32, y: i32, ch: char, style: i32) {
    emit_i32_const(body, x);
    emit_i32_const(body, y);
    emit_i32_const(body, ch as i32);
    emit_i32_const(body, style);
    emit_call(body, 1);
}

fn emit_put_text(body: &mut Vec<u8>, x: i32, y: i32, text: &str, style: i32) {
    for (index, ch) in text.chars().enumerate() {
        emit_put_cell(body, x + index as i32, y, ch, style);
    }
}

fn emit_draw_gutter(body: &mut Vec<u8>, y: i32, value: i32, style: i32) {
    emit_i32_const(body, y);
    emit_i32_const(body, 0);
    emit_i32_const(body, value);
    emit_i32_const(body, style);
    emit_call(body, 2);
}

fn emit_status_right(body: &mut Vec<u8>, text: &str, y: i32, style: i32) {
    for (index, ch) in text.chars().enumerate() {
        emit_local_get(body, 0);
        emit_i32_const(body, text.chars().count() as i32 + 1 - index as i32);
        body.push(OpCode::I32Sub as u8);
        emit_i32_const(body, y);
        emit_i32_const(body, ch as i32);
        emit_i32_const(body, style);
        emit_call(body, 1);
    }
}

fn severity_style_id(severity: Severity) -> i32 {
    match severity {
        Severity::Error => 4,
        Severity::Warning => 3,
        Severity::Info => 5,
        Severity::Hint => 6,
    }
}

fn emit_scene(body: &mut Vec<u8>, scene: &SceneRenderModel) {
    if scene.fill_screen {
        emit_fill_screen(body);
    }

    if scene.status.left.is_some() || scene.status.file.is_some() || scene.status.right.is_some() {
        emit_i32_const(body, 0);
        emit_i32_const(body, 0);
        emit_local_get(body, 0);
        emit_i32_const(body, 1);
        emit_i32_const(body, ' ' as i32);
        emit_i32_const(body, 1);
        emit_call(body, 0);
    }

    if let Some(left) = &scene.status.left {
        emit_put_text(body, 0, 0, left, 1);
    }

    if let Some(file) = &scene.status.file {
        emit_put_text(body, 8, 0, file, 1);
    }

    if let Some(right) = &scene.status.right {
        emit_status_right(body, right, 0, 1);
    }

    for line in &scene.lines {
        let y = line.number;
        if let Some(gutter) = line.gutter {
            emit_draw_gutter(body, y, gutter, 2);
        }

        emit_put_text(body, 4, y, &line.text, 0);

        if let Some((severity, message, _)) = &line.eol_diagnostic {
            let x = 4 + line.text.chars().count() as i32 + 2;
            emit_put_text(body, x, y, message, severity_style_id(*severity));
        }

        if let Some((severity, message, at)) = &line.below_diagnostic {
            emit_put_cell(body, 4 + at, y + 1, '└', severity_style_id(*severity));
            emit_put_text(body, 5 + at, y + 1, message, severity_style_id(*severity));
        }
    }

    if let Some(cursor) = &scene.cursor {
        emit_put_cell(
            body,
            4 + cursor.col,
            cursor.line,
            if cursor.kind == "line" { '▌' } else { '█' },
            7,
        );
    }
}

pub fn compile_scene_to_wasm(source: &str) -> Vec<u8> {
    let scene = build_render_model(source);
    let mut module = Vec::new();
    module.extend_from_slice(&[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    let mut type_section = Vec::new();
    push_u32_leb(&mut type_section, 4);
    type_section.extend_from_slice(&[0x60, 0x06, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x00]);
    type_section.extend_from_slice(&[0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00]);
    type_section.extend_from_slice(&[0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00]);
    type_section.extend_from_slice(&[0x60, 0x02, 0x7f, 0x7f, 0x00]);
    encode_vec_section(1, type_section, &mut module);

    let mut import_section = Vec::new();
    push_u32_leb(&mut import_section, 3);
    push_name(&mut import_section, "env");
    push_name(&mut import_section, "fill_rect");
    import_section.push(0x00);
    push_u32_leb(&mut import_section, 0);
    push_name(&mut import_section, "env");
    push_name(&mut import_section, "put_cell");
    import_section.push(0x00);
    push_u32_leb(&mut import_section, 1);
    push_name(&mut import_section, "env");
    push_name(&mut import_section, "draw_gutter");
    import_section.push(0x00);
    push_u32_leb(&mut import_section, 2);
    encode_vec_section(2, import_section, &mut module);

    let mut function_section = Vec::new();
    push_u32_leb(&mut function_section, 1);
    push_u32_leb(&mut function_section, 3);
    encode_vec_section(3, function_section, &mut module);

    let mut export_section = Vec::new();
    push_u32_leb(&mut export_section, 1);
    push_name(&mut export_section, "render");
    export_section.push(0x00);
    push_u32_leb(&mut export_section, 3);
    encode_vec_section(7, export_section, &mut module);

    let mut code_body = Vec::new();
    push_u32_leb(&mut code_body, 0);
    emit_scene(&mut code_body, &scene);
    code_body.push(OpCode::End as u8);

    let mut code_section = Vec::new();
    push_u32_leb(&mut code_section, 1);
    push_u32_leb(&mut code_section, code_body.len() as u32);
    code_section.extend_from_slice(&code_body);
    encode_vec_section(10, code_section, &mut module);

    module
}

#[cfg(test)]
mod tests {
    use super::compile_scene_to_wasm;

    #[test]
    fn emits_a_wasm_module() {
        let bytes = compile_scene_to_wasm("screen\n  size fill\n");
        assert!(bytes.starts_with(&[0x00, 0x61, 0x73, 0x6d]));
        assert!(bytes.len() > 32);
    }
}
