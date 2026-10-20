mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b", "us-east-1c"] }
  }
}

variables {
  name = "test"
}

run "three_tiers_over_two_azs" {
  command = apply

  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.private) == 2 && length(aws_subnet.isolated) == 2
    error_message = "Expected two subnets per tier"
  }
  assert {
    condition     = length(aws_nat_gateway.this) == 2
    error_message = "Expected one NAT gateway per AZ"
  }
  assert {
    condition     = length(distinct(concat(aws_subnet.public[*].cidr_block, aws_subnet.private[*].cidr_block, aws_subnet.isolated[*].cidr_block))) == 6
    error_message = "Subnet CIDRs must not overlap between tiers"
  }
}

run "isolated_tier_has_no_internet_route" {
  command = apply

  assert {
    condition     = length(aws_route_table.isolated.route) == 0
    error_message = "Isolated route table must not have any route"
  }
  assert {
    condition     = alltrue([for rt in aws_route_table.private : length(rt.route) == 1])
    error_message = "Each private route table must only route out through its NAT gateway"
  }
}

run "rejects_a_single_az" {
  command = plan
  variables {
    az_count = 1
  }
  expect_failures = [var.az_count]
}
