import {
  CONTROL_TABLE_COMPONENT_NAME,
  CONTROL_TABLE_POLICY,
  USER_POOL_CLIENT_NAME,
  USER_POOL_CLIENT_POLICY,
  USER_POOL_COMPONENT_NAME,
  USER_POOL_POLICY,
  controlTableDeletionProtection,
} from "./config/control.js";
import { configureLeastPrivilegeDynamoLink } from "./dynamo-link.js";

export function createControlResources(options: { production: boolean }) {
  configureLeastPrivilegeDynamoLink();
  const userPool = new sst.aws.CognitoUserPool(USER_POOL_COMPONENT_NAME, {
    usernames: [...USER_POOL_POLICY.usernames],
    transform: {
      userPool(args) {
        args.adminCreateUserConfig = {
          ...(args.adminCreateUserConfig ?? {}),
          allowAdminCreateUserOnly: USER_POOL_POLICY.allowAdminCreateUserOnly,
        };
      },
    },
  });
  const userPoolClient = userPool.addClient(USER_POOL_CLIENT_NAME, {
    transform: {
      client(args) {
        args.generateSecret = USER_POOL_CLIENT_POLICY.generateSecret;
        args.allowedOauthFlowsUserPoolClient = USER_POOL_CLIENT_POLICY.oauthEnabled;
        delete args.allowedOauthFlows;
        delete args.allowedOauthScopes;
        delete args.callbackUrls;
        delete args.logoutUrls;
        args.explicitAuthFlows = [...USER_POOL_CLIENT_POLICY.explicitAuthFlows];
        args.preventUserExistenceErrors = USER_POOL_CLIENT_POLICY.preventUserExistenceErrors;
      },
    },
  });
  const table = new sst.aws.Dynamo(CONTROL_TABLE_COMPONENT_NAME, {
    fields: CONTROL_TABLE_POLICY.fields,
    primaryIndex: CONTROL_TABLE_POLICY.primaryIndex,
    globalIndexes: CONTROL_TABLE_POLICY.globalIndexes,
    deletionProtection: controlTableDeletionProtection(options.production),
  });
  return { userPool, userPoolClient, table };
}
