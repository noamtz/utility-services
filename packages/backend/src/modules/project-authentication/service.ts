import {
  FILE_MANAGEMENT_UTILITY,
  TrustedProjectContextSchema,
  type TrustedProjectContext,
} from "@utility-services/contracts";

import { HttpError } from "../../core/http/handler.js";
import {
  DUMMY_SECRET_HASH,
  compareSecretHashes,
  decodeSecretHash,
  hashApiKeySecret,
  type DigestComparator,
  type ParsedProjectApiKey,
} from "../identity-control/credentials/credential.js";
import {
  CorruptCredentialRecordError,
  type CredentialRepository,
} from "../identity-control/credentials/repository.js";
import type { ProjectRequestLimiter } from "./rate-limit/service.js";

export interface ProjectAuthenticationService {
  authenticate(credential: ParsedProjectApiKey): Promise<TrustedProjectContext>;
}

export interface ProjectAuthenticationDependencies {
  readonly repository: CredentialRepository;
  readonly compareDigests?: DigestComparator;
  readonly limiter?: ProjectRequestLimiter;
}

export function unauthorized(): HttpError {
  return new HttpError(401, "UNAUTHORIZED", "Authentication required");
}

export function createProjectAuthenticationService(
  dependencies: ProjectAuthenticationDependencies,
): ProjectAuthenticationService {
  const compareDigests = dependencies.compareDigests;

  return {
    async authenticate(credential) {
      const presentedDigest = hashApiKeySecret(credential.secret);
      let lookup;
      try {
        lookup = await dependencies.repository.getLookup(credential.keyId);
      } catch (error) {
        if (!(error instanceof CorruptCredentialRecordError)) throw error;
      }

      let storedDigest = decodeSecretHash(DUMMY_SECRET_HASH);
      let digestValid = false;
      if (lookup) {
        try {
          storedDigest = decodeSecretHash(lookup.secretHash);
          digestValid = true;
        } catch {
          digestValid = false;
        }
      }
      const digestMatches = compareSecretHashes(presentedDigest, storedDigest, compareDigests);
      if (!lookup || !digestValid || !digestMatches || lookup.status !== "active") {
        throw unauthorized();
      }

      let snapshot;
      try {
        snapshot = await dependencies.repository.getVerificationSnapshot(
          lookup.keyId,
          lookup.publicProjectId,
        );
      } catch (error) {
        if (error instanceof CorruptCredentialRecordError) throw unauthorized();
        throw error;
      }
      if (
        !snapshot ||
        snapshot.lookup.status !== "active" ||
        snapshot.metadata.status !== "active" ||
        snapshot.lookup.keyId !== credential.keyId ||
        snapshot.metadata.keyId !== credential.keyId ||
        snapshot.lookup.publicProjectId !== snapshot.project.publicProjectId ||
        snapshot.lookup.internalProjectId !== snapshot.project.internalProjectId ||
        snapshot.project.status !== "active" ||
        !snapshot.project.enabledUtilities.includes(FILE_MANAGEMENT_UTILITY)
      ) {
        throw unauthorized();
      }

      const result = TrustedProjectContextSchema.safeParse({
        internalProjectId: snapshot.project.internalProjectId,
        publicProjectId: snapshot.project.publicProjectId,
        keyId: snapshot.lookup.keyId,
        enabledUtilities: snapshot.project.enabledUtilities,
        fileManagement: snapshot.project.fileManagement,
      });
      if (!result.success) throw unauthorized();
      await dependencies.limiter?.admit(result.data.internalProjectId);
      return Object.freeze(result.data);
    },
  };
}
