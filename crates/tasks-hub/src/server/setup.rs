//! The routes of the first start in the page (`crate::firststart`): what is missing, the vault and Neovim chosen in
//! the dialog of the system, and the installation. The page names no path in any of them.

use super::*;

/// The problems of the start that the step for Neovim fixes.
const NVIM_PROBLEMS: [&str; 3] = ["nvim_not_found", "nvim_too_old", "nvim_probe_failed"];

fn first_start_unavailable() -> Response {
    error_body(
        StatusCode::NOT_FOUND,
        "setup_unavailable",
        "this hub has no first start in the page",
    )
}

fn not_now(why: &str) -> Response {
    error_body(StatusCode::CONFLICT, "not_now", why)
}

/// `GET /api/tasks/setup`: what the page of the first start shows. `problem` is the short code of what stops the
/// engine (`no_vault`, `nvim_not_found`, ...; `null`: none), `install` what is offered about the installation
/// (`install`, `replace`, `installed`, `declined`; `null` when that cannot be said), `pick_program` whether the hub
/// can show a dialog for the program of Neovim, `program` the file name of that program (`nvim.exe`), `example` what
/// "Open the example vault" would copy (its `areas` and the number of its `files`; `null`: this hub has none).
pub(super) async fn setup_state(
    State(st): State<Arc<Shared>>,
    RawQuery(query): RawQuery,
) -> Response {
    if let Some(response) = no_query(query.as_deref()) {
        return response;
    }
    let rt = st.rt();
    let Some(first) = rt.first_start.clone() else {
        return first_start_unavailable();
    };
    let install = match first.install_offer() {
        Ok(offer) => Some(offer),
        Err(why) => {
            eprintln!("note: the installation cannot be offered: {why}");
            None
        }
    };
    let example = {
        let first = Arc::clone(&first);
        tokio::task::spawn_blocking(move || {
            first
                .example_vault()
                .and_then(|at| crate::newvault::example(&at))
        })
        .await
        .ok()
        .flatten()
    };
    axum::Json(json!({
        "problem": rt.status.problem,
        "install": install,
        "pick_program": first.can_pick_program(),
        "program": appkit_hub::editor::nvim_file_name(),
        "example": example.map(|e| json!({ "areas": e.areas, "files": e.files })),
    }))
    .into_response()
}

/// Read the runtime the step left, and answer with the problem that is left (`null`: the hub is set up).
fn after_step(st: &Shared, target: VaultTarget) -> Response {
    let problem = target.status.problem;
    st.replace_runtime((st.build)(target));
    axum::Json(json!({ "chosen": true, "problem": problem })).into_response()
}

/// `POST /api/tasks/setup_vault` `{}` or `{ "area" }`: show the folder dialog and keep the folder the person chose
/// as the vault (with `area`: make it a new vault with that one area first). Only while the hub has no vault it can
/// use. `{ "chosen": false }`: the dialog was closed.
pub(super) async fn setup_vault(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["area"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    let area = if map.contains_key("area") {
        match vault_text(&map, "area", 128) {
            Ok(a) => Some(a),
            Err(r) => return r,
        }
    } else {
        None
    };
    let rt = st.rt();
    let (Some(first), Some(opener)) = (rt.first_start.clone(), rt.opener.clone()) else {
        return first_start_unavailable();
    };
    if rt.setup_required().is_none() {
        return not_now("the hub has a vault; choose another in the list of vaults");
    }
    drop(rt);
    let chosen = match tokio::task::spawn_blocking(move || opener.pick_folder()).await {
        Ok(Ok(Some(folder))) => folder,
        Ok(Ok(None)) => return axum::Json(json!({ "chosen": false })).into_response(),
        Ok(Err(why)) => return error_body(StatusCode::BAD_GATEWAY, "pick_failed", &why),
        Err(_) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "pick_failed",
                "the folder dialog stopped unexpectedly",
            )
        }
    };
    let folder = match appkit_hub::setup::checked_vault(&chosen.to_string_lossy(), None) {
        Ok(folder) => folder,
        Err(refused) => {
            return error_body(StatusCode::BAD_REQUEST, "vault_refused", refused.for_page())
        }
    };
    if let Some(area) = area {
        let at = folder.clone();
        match tokio::task::spawn_blocking(move || crate::newvault::create(&at, &area)).await {
            Ok(Ok(())) => {}
            Ok(Err(refused)) => {
                return error_body(StatusCode::BAD_REQUEST, refused.code, refused.why)
            }
            Err(_) => {
                return error_body(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "vault_create_failed",
                    "the vault could not be made",
                )
            }
        }
    }
    let _one_at_a_time = st.switching.lock().await;
    // Asked again under the lock: a second page may have set the vault while the dialog was open.
    if st.rt().setup_required().is_none() {
        return not_now("the hub has a vault; choose another in the list of vaults");
    }
    match first.set_vault(folder).await {
        Ok(target) => after_step(&st, target),
        Err(why) => error_body(StatusCode::BAD_REQUEST, "vault_refused", &why),
    }
}

/// `POST /api/tasks/setup_example` `{}`: "Open the example vault". Show the folder dialog, copy the example vault of
/// the engine into the folder the person chose (an empty one: nothing is written over, and the example is never opened
/// where it lies) and keep that copy as the vault. Only while the hub has no vault it can use. `{ "chosen": false }`:
/// the dialog was closed, nothing was written.
pub(super) async fn setup_example(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    if let Err(r) = vault_request(&body, &[]) {
        return r;
    }
    let rt = st.rt();
    let (Some(first), Some(opener)) = (rt.first_start.clone(), rt.opener.clone()) else {
        return first_start_unavailable();
    };
    if rt.setup_required().is_none() {
        return not_now("the hub has a vault; choose another in the list of vaults");
    }
    drop(rt);
    let source = {
        let first = Arc::clone(&first);
        tokio::task::spawn_blocking(move || first.example_vault())
            .await
            .ok()
            .flatten()
    };
    let Some(source) = source else {
        return error_body(
            StatusCode::NOT_FOUND,
            "no_example",
            "this hub has no example vault",
        );
    };
    let chosen = match tokio::task::spawn_blocking(move || opener.pick_folder()).await {
        Ok(Ok(Some(folder))) => folder,
        Ok(Ok(None)) => return axum::Json(json!({ "chosen": false })).into_response(),
        Ok(Err(why)) => return error_body(StatusCode::BAD_GATEWAY, "pick_failed", &why),
        Err(_) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "pick_failed",
                "the folder dialog stopped unexpectedly",
            )
        }
    };
    let folder = match appkit_hub::setup::checked_vault(&chosen.to_string_lossy(), None) {
        Ok(folder) => folder,
        Err(refused) => {
            return error_body(StatusCode::BAD_REQUEST, "vault_refused", refused.for_page())
        }
    };
    let _one_at_a_time = st.switching.lock().await;
    // Asked again under the lock, before anything is written: a second page may have set the vault meanwhile.
    if st.rt().setup_required().is_none() {
        return not_now("the hub has a vault; choose another in the list of vaults");
    }
    let at = folder.clone();
    match tokio::task::spawn_blocking(move || crate::newvault::copy_example(&source, &at)).await {
        Ok(Ok(_)) => {}
        Ok(Err(refused)) => return error_body(StatusCode::BAD_REQUEST, refused.code, refused.why),
        Err(_) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "vault_create_failed",
                "the example could not be copied",
            )
        }
    }
    match first.set_vault(folder).await {
        Ok(target) => after_step(&st, target),
        Err(why) => error_body(StatusCode::BAD_REQUEST, "vault_refused", &why),
    }
}

/// `POST /api/tasks/setup_nvim` `{}`: show the file dialog for the program of Neovim, probe what the person chose and
/// keep it. Only while Neovim is what stops the engine. `{ "chosen": false }`: the dialog was closed.
pub(super) async fn setup_nvim(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    if let Err(r) = vault_request(&body, &[]) {
        return r;
    }
    let rt = st.rt();
    let Some(first) = rt.first_start.clone() else {
        return first_start_unavailable();
    };
    let needs_nvim = |problem: Option<&str>| problem.is_some_and(|p| NVIM_PROBLEMS.contains(&p));
    if !needs_nvim(rt.status.problem) {
        return not_now("Neovim is not what the hub is missing");
    }
    drop(rt);
    let picker = Arc::clone(&first);
    let chosen = match tokio::task::spawn_blocking(move || picker.pick_program()).await {
        Ok(Ok(Some(program))) => program,
        Ok(Ok(None)) => return axum::Json(json!({ "chosen": false })).into_response(),
        Ok(Err(why)) => return error_body(StatusCode::BAD_GATEWAY, "pick_failed", &why),
        Err(_) => {
            return error_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "pick_failed",
                "the file dialog stopped unexpectedly",
            )
        }
    };
    let _one_at_a_time = st.switching.lock().await;
    if !needs_nvim(st.rt().status.problem) {
        return not_now("Neovim is not what the hub is missing");
    }
    match first.set_nvim(chosen).await {
        Ok(target) => after_step(&st, target),
        Err(why) => error_body(StatusCode::BAD_REQUEST, "nvim_refused", &why),
    }
}

/// `POST /api/tasks/setup_install` `{ "autostart", "shortcut" }`: install the program (`tasks-hub install`, which
/// stops this hub and starts it again from the installed copy; the page waits for it). `{ "decline": true }`: the
/// person does not want it, and it is not offered again.
pub(super) async fn setup_install(State(st): State<Arc<Shared>>, body: Bytes) -> Response {
    let map = match vault_request(&body, &["autostart", "shortcut", "decline"]) {
        Ok(m) => m,
        Err(r) => return r,
    };
    // `None`: not a yes or no.
    let flag = |key: &str| match map.get(key) {
        None => Some(false),
        Some(serde_json::Value::Bool(b)) => Some(*b),
        Some(_) => None,
    };
    let (Some(autostart), Some(shortcut), Some(decline)) =
        (flag("autostart"), flag("shortcut"), flag("decline"))
    else {
        return error_body(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "autostart, shortcut and decline are true or false",
        );
    };
    let Some(first) = st.rt().first_start.clone() else {
        return first_start_unavailable();
    };
    if decline {
        if autostart || shortcut {
            return error_body(
                StatusCode::BAD_REQUEST,
                "bad_request",
                "a declined installation has no options",
            );
        }
        return match first.decline_install() {
            Ok(()) => axum::Json(json!({ "ok": true })).into_response(),
            Err(why) => error_body(StatusCode::INTERNAL_SERVER_ERROR, "setup_failed", &why),
        };
    }
    match first.install_offer() {
        Ok(appkit_hub::setup::InstallOffer::Installed) => {
            return not_now("the program is installed");
        }
        Ok(_) => {}
        Err(why) => return error_body(StatusCode::INTERNAL_SERVER_ERROR, "setup_failed", &why),
    }
    match first.install(autostart, shortcut) {
        Ok(()) => (StatusCode::ACCEPTED, axum::Json(json!({ "ok": true }))).into_response(),
        Err(why) => error_body(StatusCode::BAD_GATEWAY, "install_failed", &why),
    }
}
