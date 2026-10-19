mock_provider "aws" {}
mock_provider "random" {}

variables {
  name         = "test"
  vpc_id       = "vpc-1"
  subnet_ids   = ["subnet-1", "subnet-2"]
  protect_data = true
}

run "database_is_private_encrypted_and_multi_az" {
  command = apply

  assert {
    condition     = aws_db_instance.this.multi_az && aws_db_instance.this.storage_encrypted && !aws_db_instance.this.publicly_accessible
    error_message = "Database must be multi-AZ, encrypted and not public"
  }
  assert {
    condition     = aws_db_instance.this.engine == "postgres" && aws_db_instance.this.engine_version == "16"
    error_message = "PostgreSQL 16 expected"
  }
}

run "database_security_group_has_no_egress_and_no_open_ingress" {
  command = apply

  assert {
    condition     = length(aws_security_group.this.egress) == 0 && length(aws_security_group.this.ingress) == 0
    error_message = "Rules must come from the clients, never inline"
  }
}

run "one_secret_per_role_with_the_expected_usernames" {
  command = apply

  assert {
    condition     = toset(keys(aws_secretsmanager_secret.role)) == toset(["admin", "app_user", "relay_user"])
    error_message = "Expected admin, app_user and relay_user secrets"
  }
  assert {
    condition     = jsondecode(aws_secretsmanager_secret_version.role["relay_user"].secret_string).username == "outbox_relay" && jsondecode(aws_secretsmanager_secret_version.role["admin"].secret_string).username == "root"
    error_message = "Secret usernames must match the database roles"
  }
}

run "protected_data_keeps_the_instance_and_secrets_recoverable" {
  command = apply

  assert {
    condition     = aws_db_instance.this.deletion_protection && !aws_db_instance.this.skip_final_snapshot && aws_db_instance.this.final_snapshot_identifier == "test-database-final"
    error_message = "Protected data needs deletion protection and a final snapshot"
  }
  assert {
    condition     = alltrue([for s in aws_secretsmanager_secret.role : s.recovery_window_in_days == 30])
    error_message = "Protected secrets keep a recovery window"
  }
}

run "disposable_environment_can_be_destroyed_and_recreated" {
  command = apply
  variables {
    protect_data = false
  }

  assert {
    condition     = !aws_db_instance.this.deletion_protection && aws_db_instance.this.skip_final_snapshot
    error_message = "Disposable data must be destroyable"
  }
  assert {
    condition     = alltrue([for s in aws_secretsmanager_secret.role : s.recovery_window_in_days == 0])
    error_message = "Disposable secrets must be deleted immediately so the name can be reused"
  }
}
