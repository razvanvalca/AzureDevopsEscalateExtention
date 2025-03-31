import * as SDK from "azure-devops-extension-sdk";
import {
  IWorkItemFormService,
  WorkItem,
} from "azure-devops-extension-api/WorkItemTracking/";
import { getClient } from "azure-devops-extension-api";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";

let currentWorkItemId: number | undefined;
let currentProjectName: string | undefined;

// Called when user clicks the Escalate button
async function onEscalateClick() {
  if (!currentWorkItemId || !currentProjectName) {
    alert(
      "Work item data is missing. Make sure this extension is running in a valid work item form."
    );
    return;
  }

  try {
    const witClient = getClient(WorkItemTrackingRestClient);

    // Retrieve the current work item (including your custom field)
    const currentWorkItem: WorkItem = await witClient.getWorkItem(currentWorkItemId);

    // 1. Read the custom field "Custom.CTRM_CustomerDetails"
    const customerDetails =
      currentWorkItem.fields["Custom.CTRM_CustomerDetails"] || "";

    // 2. Use a regex to extract the fuse portal link
    //    This pattern grabs the entire "https://fuse.portals.swisslife.ch/dashboard/..."
    const fuseLinkRegex = /(https:\/\/fuse\.portals\.swisslife\.ch\/dashboard\/[^"\)]+)/i;
    const match = fuseLinkRegex.exec(customerDetails);

    // Build an HTML link for the fuse portal if found
    let fuseLinkHTML = "";
    if (match && match[1]) {
      fuseLinkHTML = `
        <p>
          <a href="${match[1]}" target="_blank">Show customer in Fuse</a>
        </p>
      `;
    }

    // Prepare an HTML link to the current (parent) work item (the "Support Ticket")
    // For example, https://dev.azure.com/ORG_NAME/PROJECT_NAME/_workitems/edit/123
    const supportTicketLink = `https://dev.azure.com/${SDK.getHost().name}/${currentProjectName}/_workitems/edit/${currentWorkItemId}`;

    // The existing support ticket description (already HTML)
    const originalDescription = currentWorkItem.fields["System.Description"] || "";

    // 3. Construct the HTML for the new Issue's description
    //    - The fuse link (if found)
    //    - A link back to the support ticket
    //    - The original description
    const newIssueDescription = `
      ${fuseLinkHTML}
      <p>
        Escalated from Support Ticket
        <a href="${supportTicketLink}" target="_blank">#${currentWorkItemId}</a>.
      </p>
      <p>Original Description:</p>
      ${originalDescription}
    `;

    // 4. Construct the PATCH document for creating the new "Issue"
    const patchDocument = [
      {
        op: "add",
        path: "/fields/System.Title",
        value: `Escalated from #${currentWorkItemId}: ${currentWorkItem.fields["System.Title"]}`,
      },
      {
        op: "add",
        path: "/fields/System.AreaPath",
        value: "CTRM\\Customer Support Center\\Kundenportal\\Product Owner",
      },
      {
        op: "add",
        path: "/fields/System.Description",
        value: newIssueDescription,
      },
      {
        // This sets the parent link to the current item
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          // The URL to the existing (parent) work item
          url: `https://dev.azure.com/${SDK.getHost().name}/${currentProjectName}/_apis/wit/workItems/${currentWorkItemId}`,
        },
      },
    ];

    // 5. Create the new Issue
    const createdWorkItem: WorkItem = await witClient.createWorkItem(
      patchDocument,
      currentProjectName,
      "Issue"
    );

    alert(
      `Issue #${createdWorkItem.id} succesfully created and linked.`
    );
  } catch (error) {
    console.error("Failed to create work item:", error);
    alert("Failed to create work item. Check console for details.");
  }
}

/**
 * Provider for the work item form events (like onLoaded, onFieldChanged, etc.)
 */
function workItemFormProvider() {
  return {
    // Called when the work item is fully loaded in the form
    onLoaded: async (_args: any) => {
      try {
        // Get the WorkItemFormService
        const formService: IWorkItemFormService =
          await SDK.getService<IWorkItemFormService>(
            "ms.vss-work-web.work-item-form"
          );

        // Retrieve the current Work Item ID
        currentWorkItemId = await formService.getId();

        // Retrieve essential field values
        const fieldValues = await formService.getFieldValues([
          "System.TeamProject",
          "System.Title",
          "System.AreaPath",
        ]);
        currentProjectName = fieldValues["System.TeamProject"] as string;

        // Show the escalate button only if the AreaPath matches
        const areaPath = fieldValues["System.AreaPath"] as string;
        const escalateBtn = document.getElementById("escalate-btn");
        if (escalateBtn) {
          if (
            areaPath ===
            "CTRM\\Customer Support Center\\Kundenportal\\Kundenportalsupport"
          ) {
            escalateBtn.style.display = "inline-block";
          } else {
            escalateBtn.style.display = "none";
          }
        }
      } catch (err) {
        console.error("Error loading work item data:", err);
      }
    },

    // Called when any field changes on the form
    onFieldChanged: (_args: any) => {
      // If you need to handle field changes, do it here
    },
  };
}

// Initialize the extension
SDK.init();

// Once the extension is ready, register the work item form contribution
SDK.ready().then(() => {
  SDK.register(SDK.getContributionId(), workItemFormProvider);

  // Attach our click handler to the Escalate button
  const escalateBtn = document.getElementById("escalate-btn");
  if (escalateBtn) {
    escalateBtn.addEventListener("click", onEscalateClick);
  }
});
