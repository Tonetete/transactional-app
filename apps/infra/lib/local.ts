/**
 * Local emulator profile only. floci injects `AWS_ENDPOINT_URL=http://localhost.floci.io:4566` into the containers it
 * starts, but those containers sit on the `floci-net` Docker network, where the DNS server floci hands them (its bridge IP)
 * does not answer, so the name falls back to public DNS and resolves to 127.0.0.1 (the container itself). The floci
 * container's own name is resolved by Docker on that network, so the SDKs are pointed at it explicitly.
 */
export const LOCAL_AWS_ENDPOINT = "http://floci:4566";
