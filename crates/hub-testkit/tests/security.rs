//! The security matrix of the guard (concept 5.5), run for the tasks hub. The tests are written
//! once, in `appkit_testkit::security`; the kit runs them for its own minimal app, and every app
//! that has a hub runs them for itself.

mod tasks {
    appkit_testkit::security_matrix!(hub_testkit::subjects::Tasks);
}

mod tasks_with_phone_page {
    appkit_testkit::security_matrix!(hub_testkit::subjects::TasksWithPhonePage);
}

#[tokio::test]
async fn the_phone_page_has_its_own_policy_and_nothing_more() {
    appkit_testkit::security::the_installable_page_has_its_own_policy_and_nothing_more(
        &hub_testkit::subjects::TasksWithPhonePage,
        hub_testkit::subjects::PHONE_PREFIX,
        hub_testkit::subjects::PHONE_WORKER_POLICY,
    )
    .await;
}
