//! The security matrix of the guard (concept 5.5), run for the tasks hub. The tests are written
//! once, in `appkit_testkit::security`; the kit runs them for its own minimal app, and every app
//! that has a hub runs them for itself.

mod tasks {
    appkit_testkit::security_matrix!(hub_testkit::subjects::Tasks);
}

mod tasks_with_phone_page {
    appkit_testkit::security_matrix!(hub_testkit::subjects::TasksWithPhonePage::new());
}

#[tokio::test]
async fn the_phone_page_has_its_own_policy_and_nothing_more() {
    appkit_testkit::security::the_installable_page_has_its_own_policy_and_nothing_more(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
        hub_testkit::subjects::PHONE_PREFIX,
        hub_testkit::subjects::PHONE_WORKER_POLICY,
    )
    .await;
    // The phone page records a voice note: the microphone is on there, and only there.
    appkit_testkit::security::the_installable_page_may_record_and_nothing_else(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
        hub_testkit::subjects::PHONE_PREFIX,
    )
    .await;
}

#[tokio::test]
async fn a_phone_pairs_once_and_then_logs_in_with_its_key() {
    appkit_testkit::security::a_device_pairs_once_and_then_logs_in_with_its_key(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
    )
    .await;
}

#[tokio::test]
async fn phone_pairing_checks_before_it_spends_the_code() {
    appkit_testkit::security::device_pairing_checks_before_it_spends_the_code(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
    )
    .await;
}

#[tokio::test]
async fn the_pc_revokes_a_phone_and_its_sessions_end() {
    appkit_testkit::security::the_pc_revokes_a_device_and_its_sessions_end(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
    )
    .await;
}

#[tokio::test]
async fn another_app_may_open_the_phone_page_and_nothing_else() {
    appkit_testkit::security::another_app_may_open_the_installable_page_and_nothing_else(
        &hub_testkit::subjects::TasksWithPhonePage::new(),
        hub_testkit::subjects::PHONE_PREFIX,
    )
    .await;
}

#[tokio::test]
async fn a_hub_without_a_device_file_has_no_device_routes() {
    appkit_testkit::security::without_devices_there_are_no_device_routes(
        &hub_testkit::subjects::Tasks,
    )
    .await;
}
